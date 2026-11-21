// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Tool/contract/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: ValidateSchema; ValidateArguments; validateSchema; validateValue
// Impact: python -B scripts/code-atlas.py show Tool/contract/schema.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package contract

import (
	"encoding/json"
	"fmt"
	"math"
)

func ValidateSchema(schema map[string]any) error { return validateSchema(schema, 0) }

// Arguments can arrive from a different client; reject a malformed schema before
// descending into it instead of panicking or treating an unknown type as valid.
func ValidateArguments(schema map[string]any, value any) error {
	if err := ValidateSchema(schema); err != nil {
		return err
	}
	return validateValue(schema, value, 0)
}

func validateSchema(schema map[string]any, depth int) error {
	if depth > 6 {
		return fmt.Errorf("schema nesting exceeds six levels")
	}
	for key := range schema {
		if key != "type" && key != "properties" && key != "required" && key != "additionalProperties" && key != "items" && key != "enum" && key != "description" {
			return fmt.Errorf("unsupported schema field %s", key)
		}
	}
	if values, present := schema["enum"]; present {
		items, ok := values.([]any)
		if !ok || len(items) == 0 || len(items) > 128 || schema["type"] == "array" || schema["type"] == "object" {
			return fmt.Errorf("enum must be a nonempty bounded array of primitive values")
		}
		base := map[string]any{"type": schema["type"]}
		for _, item := range items {
			if err := validateValue(base, item, depth); err != nil {
				return fmt.Errorf("enum value has the wrong type: %w", err)
			}
		}
	}
	switch schema["type"] {
	case "object":
		if schema["additionalProperties"] != false {
			return fmt.Errorf("object schema requires additionalProperties:false")
		}
		props, ok := schema["properties"].(map[string]any)
		if !ok || len(props) > 32 {
			return fmt.Errorf("object properties invalid")
		}
		for _, v := range props {
			child, ok := v.(map[string]any)
			if !ok {
				return fmt.Errorf("property schema invalid")
			}
			if err := validateSchema(child, depth+1); err != nil {
				return err
			}
		}
		if req, has := schema["required"]; has {
			items, ok := req.([]any)
			if !ok {
				return fmt.Errorf("required must be an array")
			}
			for _, v := range items {
				k, ok := v.(string)
				if !ok || props[k] == nil {
					return fmt.Errorf("required property is not defined")
				}
			}
		}
	case "array":
		child, ok := schema["items"].(map[string]any)
		if !ok {
			return fmt.Errorf("array items invalid")
		}
		return validateSchema(child, depth+1)
	case "string", "number", "integer", "boolean":
	default:
		return fmt.Errorf("unsupported schema type")
	}
	return nil
}
func validateValue(schema map[string]any, value any, depth int) error {
	if depth > 6 {
		return fmt.Errorf("argument nesting exceeds schema")
	}
	if values, ok := schema["enum"].([]any); ok {
		b, _ := json.Marshal(value)
		found := false
		for _, v := range values {
			other, _ := json.Marshal(v)
			found = found || string(b) == string(other)
		}
		if !found {
			return fmt.Errorf("argument not in enum")
		}
	}
	switch schema["type"] {
	case "object":
		v, ok := value.(map[string]any)
		if !ok {
			return fmt.Errorf("expected object")
		}
		props := schema["properties"].(map[string]any)
		if req, ok := schema["required"].([]any); ok {
			for _, key := range req {
				if _, ok = v[key.(string)]; !ok {
					return fmt.Errorf("missing required argument %s", key)
				}
			}
		}
		for key, value := range v {
			child, ok := props[key].(map[string]any)
			if !ok {
				return fmt.Errorf("unknown argument %s", key)
			}
			if e := validateValue(child, value, depth+1); e != nil {
				return fmt.Errorf("%s: %w", key, e)
			}
		}
	case "array":
		v, ok := value.([]any)
		if !ok || len(v) > 4096 {
			return fmt.Errorf("expected bounded array")
		}
		for _, item := range v {
			if e := validateValue(schema["items"].(map[string]any), item, depth+1); e != nil {
				return e
			}
		}
	case "string":
		if _, ok := value.(string); !ok {
			return fmt.Errorf("expected string")
		}
	case "boolean":
		if _, ok := value.(bool); !ok {
			return fmt.Errorf("expected boolean")
		}
	case "number", "integer":
		v, ok := value.(float64)
		if !ok || math.IsNaN(v) || math.IsInf(v, 0) || schema["type"] == "integer" && math.Trunc(v) != v {
			return fmt.Errorf("expected number/integer")
		}
		if schema["type"] == "integer" && math.Abs(v) > 9007199254740991 {
			return fmt.Errorf("integer exceeds JavaScript safe range; use a decimal string schema for exact large values")
		}
	}
	return nil
}
