// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Link/app/link-core/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: lanFixtureIPv4; lanFixtureULA; lanEntry; TestLANRejectsUntrustedMetadataAndPublicAddresses; TestLANNameSurvivesDNSWireRoundTrip; TestLANCollectBoundedDeduplicatedAndLibraryClosure; TestLANAdvertisementUsesOnlyReachableInterfacesAndPublicMetadata
// Impact: python -B scripts/code-atlas.py show Link/app/link-core/link/lan_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package link

import (
	"context"
	"errors"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/libp2p/zeroconf/v2"
	"github.com/miekg/dns"
)

// Synthetic protocol-class fixtures; these are never contacted or discovered.
func lanFixtureIPv4(last byte) net.IP { return net.IPv4(192, 168, 1, last) }

func lanFixtureULA() net.IP {
	return net.IP{0xfd, 0x12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2}
}

func lanEntry() *zeroconf.ServiceEntry {
	return &zeroconf.ServiceEntry{Port: 17920, Text: []string{
		"protocol=" + protocol, "id=" + strings.Repeat("a", 32),
		"pin=" + strings.Repeat("b", 64), "name=Private laptop", "version=" + Version,
	}, AddrIPv4: []net.IP{lanFixtureIPv4(20)}}
}

func TestLANRejectsUntrustedMetadataAndPublicAddresses(t *testing.T) {
	entry := lanEntry()
	entry.AddrIPv4 = append(entry.AddrIPv4, net.ParseIP("192.0.2.1"), net.ParseIP("127.0.0.1"))
	entry.AddrIPv6 = []net.IP{lanFixtureULA(), net.IP{0xfe, 0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1}, net.ParseIP("::1")}
	got := candidatesFromEntry(entry)
	if len(got) != 2 || got[0].Verified || got[1].Verified || got[0].ID == got[1].ID {
		t.Fatalf("unsafe or missing candidate: %+v", got)
	}
	for _, mutate := range []func(*zeroconf.ServiceEntry){
		func(e *zeroconf.ServiceEntry) { e.Text = append(e.Text, "pin="+strings.Repeat("c", 64)) },
		func(e *zeroconf.ServiceEntry) { e.Text[0] = "protocol=foreign/1" },
		func(e *zeroconf.ServiceEntry) { e.Text[1] = "id=not-an-identity" },
		func(e *zeroconf.ServiceEntry) { e.Text[2] = "pin=" + strings.Repeat("B", 64) },
		func(e *zeroconf.ServiceEntry) { e.Text[3] = "name=untrusted\nname" },
		func(e *zeroconf.ServiceEntry) { e.Text[3] = `name=untrusted\010name` },
		func(e *zeroconf.ServiceEntry) { e.Text[3] = `name=invalid\255` },
		func(e *zeroconf.ServiceEntry) { e.Text[3] = "name=" + strings.Repeat("界", 41) },
		func(e *zeroconf.ServiceEntry) { e.Port = 65536 },
	} {
		bad := lanEntry()
		mutate(bad)
		if len(candidatesFromEntry(bad)) != 0 {
			t.Fatal("invalid broadcast accepted")
		}
	}
}

func TestLANNameSurvivesDNSWireRoundTrip(t *testing.T) {
	for _, name := range []string{"LAN验收原主机", strings.Repeat("界", 40), `方案 "\123"`} {
		t.Run(name, func(t *testing.T) {
			identity := Identity{ID: strings.Repeat("a", 32), Name: name, TLSFingerprint: strings.Repeat("b", 64)}
			interfaces := []net.Interface{{Index: 1, Flags: net.FlagUp | net.FlagMulticast}}
			announcement, err := announcementFor(identity, &net.TCPAddr{IP: lanFixtureIPv4(20), Port: 17920}, interfaces, func(net.Interface) ([]net.Addr, error) {
				return []net.Addr{&net.IPNet{IP: lanFixtureIPv4(20), Mask: net.CIDRMask(24, 32)}}, nil
			})
			if err != nil {
				t.Fatal(err)
			}
			message := dns.Msg{Answer: []dns.RR{&dns.TXT{Hdr: dns.RR_Header{Name: "test.local.", Rrtype: dns.TypeTXT, Class: dns.ClassINET}, Txt: announcement.Text}}}
			wire, err := message.Pack()
			if err != nil {
				t.Fatal(err)
			}
			var received dns.Msg
			if err := received.Unpack(wire); err != nil {
				t.Fatal(err)
			}
			entry := lanEntry()
			entry.Text = received.Answer[0].(*dns.TXT).Txt
			candidates := candidatesFromEntry(entry)
			if len(candidates) != 1 || candidates[0].Name != name || candidates[0].Verified {
				t.Fatalf("name or trust changed during DNS round trip: %+v", candidates)
			}
		})
	}
}

func TestLANCollectBoundedDeduplicatedAndLibraryClosure(t *testing.T) {
	got, err := collectLAN(context.Background(), time.Second, func(ctx context.Context, entries chan<- *zeroconf.ServiceEntry) error {
		defer close(entries)
		for n := 0; n < 80; n++ {
			e := lanEntry()
			e.AddrIPv4 = []net.IP{lanFixtureIPv4(byte(n/2 + 1))}
			select {
			case entries <- e:
			case <-ctx.Done():
				return nil
			}
		}
		return nil
	})
	if err != nil || len(got.Candidates) != 32 || got.Source != "mdns" || got.ObservedAt == "" {
		t.Fatalf("%+v %v", got, err)
	}
	seen := map[string]bool{}
	for _, candidate := range got.Candidates {
		if seen[candidate.ID] {
			t.Fatal("duplicate discovery candidate")
		}
		seen[candidate.ID] = true
	}
	// Multicast initialization can fail before the library owns channel closure.
	_, err = collectLAN(context.Background(), time.Second, func(context.Context, chan<- *zeroconf.ServiceEntry) error { return errors.New("socket unavailable") })
	if err == nil {
		t.Fatal("multicast failure hidden")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = collectLAN(ctx, time.Second, func(context.Context, chan<- *zeroconf.ServiceEntry) error { return nil })
	if !errors.Is(err, context.Canceled) {
		t.Fatal("parent cancellation ignored", err)
	}
}

func TestLANAdvertisementUsesOnlyReachableInterfacesAndPublicMetadata(t *testing.T) {
	identity := Identity{ID: strings.Repeat("a", 32), Name: "Private workstation", TLSFingerprint: strings.Repeat("b", 64), PrivateKey: "never-broadcast"}
	interfaces := []net.Interface{
		{Index: 1, Name: "lan", Flags: net.FlagUp | net.FlagMulticast},
		{Index: 2, Name: "loop", Flags: net.FlagUp | net.FlagMulticast | net.FlagLoopback},
		{Index: 3, Name: "down", Flags: net.FlagMulticast},
	}
	addresses := func(net.Interface) ([]net.Addr, error) {
		return []net.Addr{&net.IPNet{IP: lanFixtureIPv4(20), Mask: net.CIDRMask(24, 32)},
			&net.IPNet{IP: net.ParseIP("192.0.2.1"), Mask: net.CIDRMask(24, 32)},
			&net.IPNet{IP: lanFixtureULA(), Mask: net.CIDRMask(64, 128)}}, nil
	}
	value, err := announcementFor(identity, &net.TCPAddr{IP: net.IPv4zero, Port: 17920}, interfaces, addresses)
	if err != nil || len(value.Interfaces) != 1 || len(value.IPs) != 1 || value.IPs[0] != lanFixtureIPv4(20).String() || strings.Contains(strings.Join(value.Text, "\n"), identity.PrivateKey) {
		t.Fatalf("invalid advertisement: %+v %v", value, err)
	}
	if _, err = announcementFor(identity, &net.TCPAddr{IP: net.ParseIP("127.0.0.1"), Port: 17920}, interfaces, addresses); err == nil {
		t.Fatal("loopback advertised")
	}
}
