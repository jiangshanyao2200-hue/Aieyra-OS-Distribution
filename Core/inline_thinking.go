// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: inlineThinking; asciiLower; feed; normalizeInlineThinking; inlineThinkingEvents; inlineThinkingStream
// Impact: python -B scripts/code-atlas.py show Core/inline_thinking.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"strings"
)

// Some compatible endpoints send a leading XML thinking block in content.
// Decode only that prefix; quoted examples and tags in the answer stay literal.
// Each request attempt owns its decoder, including incomplete tag fragments.
type inlineThinking struct {
	pending string
	closing string
	body    bool
	seen    bool
}

func asciiLower(text string) string {
	data := []byte(text)
	for i, b := range data {
		if b >= 'A' && b <= 'Z' {
			data[i] = b + ('a' - 'A')
		}
	}
	return string(data)
}

func (d *inlineThinking) feed(text string, final bool, emit func(Event) error) error {
	d.pending += text
	for d.pending != "" {
		if d.body {
			text, d.pending = d.pending, ""
			return emit(Event{Kind: EventDelta, Text: text})
		}
		if d.closing == "" {
			if d.seen {
				d.pending = strings.TrimLeft(d.pending, " \t\r\n")
			}
			trimmed := strings.TrimLeft(d.pending, " \t\r\n")
			lower := asciiLower(trimmed)
			matched, partial := "", trimmed == ""
			for _, tag := range []string{"<think>", "<thinking>"} {
				if strings.HasPrefix(lower, tag) {
					matched = tag
					break
				}
				partial = partial || strings.HasPrefix(tag, lower)
			}
			if matched == "" {
				if partial && !final {
					return nil
				}
				d.body = true
				continue
			}
			d.pending = trimmed[len(matched):]
			d.closing = "</" + matched[1:]
			d.seen = true
			if err := emit(Event{Kind: EventReasoningStart}); err != nil {
				return err
			}
			continue
		}
		end := strings.Index(asciiLower(d.pending), d.closing)
		if end >= 0 {
			if end > 0 {
				if err := emit(Event{Kind: EventReasoning, Text: d.pending[:end]}); err != nil {
					return err
				}
			}
			d.pending, d.closing = d.pending[end+len(d.closing):], ""
			if err := emit(Event{Kind: EventReasoningDone}); err != nil {
				return err
			}
			continue
		}
		keep := 0
		if !final {
			for n := 1; n < len(d.closing) && n <= len(d.pending); n++ {
				if strings.EqualFold(d.pending[len(d.pending)-n:], d.closing[:n]) {
					keep = n
				}
			}
		}
		part := d.pending[:len(d.pending)-keep]
		d.pending = d.pending[len(d.pending)-keep:]
		if part != "" {
			return emit(Event{Kind: EventReasoning, Text: part})
		}
		return nil
	}
	return nil
}

func normalizeInlineThinking(m *Message) *Message {
	if m == nil {
		return nil
	}
	copy := *m
	var decoder inlineThinking
	var body, thought strings.Builder
	_ = decoder.feed(copy.Content, true, func(e Event) error {
		if e.Kind == EventDelta {
			body.WriteString(e.Text)
		} else if e.Kind == EventReasoning {
			thought.WriteString(e.Text)
		}
		return nil
	})
	copy.Content = body.String()
	if text := thought.String(); text != "" {
		if copy.ReasoningContent != "" {
			copy.ReasoningContent += "\n"
		}
		copy.ReasoningContent += text
	}
	return &copy
}

func inlineThinkingEvents(send func(Event) error) func(Event) error {
	var decoder inlineThinking
	var source, inlineSource Event
	converted := func(event Event) error {
		event.OutputIndex, event.ContentIndex = source.OutputIndex, source.ContentIndex
		if event.Kind == EventReasoning {
			event.ReasoningKind = "text"
		}
		return send(event)
	}
	samePart := func(a, b Event) bool {
		return a.OutputIndex != nil && b.OutputIndex != nil && *a.OutputIndex == *b.OutputIndex &&
			a.ContentIndex != nil && b.ContentIndex != nil && *a.ContentIndex == *b.ContentIndex
	}
	return func(event Event) error {
		if event.Kind == EventBodyPreparing && !decoder.body {
			prefix := asciiLower(strings.TrimLeft(event.Text, " \t\r\n"))
			// Responses announces body activity before releasing its ordered text.
			// A possible XML prefix must reach the decoder before it can be body.
			if decoder.seen || prefix == "" || strings.HasPrefix("<think>", prefix) || strings.HasPrefix("<thinking>", prefix) || strings.HasPrefix(prefix, "<think>") || strings.HasPrefix(prefix, "<thinking>") {
				return nil
			}
		}
		if event.Kind == EventDelta {
			source = event
			seen := decoder.seen
			err := decoder.feed(event.Text, false, converted)
			if !seen && decoder.seen {
				inlineSource = event
			}
			return err
		}
		if event.Kind == EventTextCorrection && event.CorrectionKind == EventDelta && decoder.seen && samePart(event, inlineSource) {
			var next inlineThinking
			var body, thought strings.Builder
			if err := next.feed(event.Text, true, func(e Event) error {
				if e.Kind == EventDelta {
					body.WriteString(e.Text)
				} else if e.Kind == EventReasoning {
					thought.WriteString(e.Text)
				}
				return nil
			}); err != nil {
				return err
			}
			decoder = next
			correction := event
			correction.CorrectionKind, correction.ReasoningKind, correction.Text = EventReasoning, "text", thought.String()
			if err := send(correction); err != nil {
				return err
			}
			event.Text = body.String()
		}
		if event.Kind == EventResponse || event.Kind == EventDone || event.Kind == EventFinish || event.Kind == EventError {
			if err := decoder.feed("", true, converted); err != nil {
				return err
			}
			if decoder.closing != "" {
				decoder.closing, decoder.body = "", true
				if err := converted(Event{Kind: EventReasoningDone}); err != nil {
					return err
				}
			}
		}
		if event.Kind == EventResponse {
			event.Message = normalizeInlineThinking(event.Message)
		}
		if event.Kind == EventBodyPreparing {
			event.Text = ""
		}
		return send(event)
	}
}

func inlineThinkingStream(ctx context.Context, input <-chan Event) <-chan Event {
	out := make(chan Event, 64)
	go func() {
		defer close(out)
		send := inlineThinkingEvents(func(event Event) error {
			select {
			case out <- event:
				return nil
			case <-ctx.Done():
				return ctx.Err()
			}
		})
		for event := range input {
			if err := send(event); err != nil {
				return
			}
		}
	}()
	return out
}
