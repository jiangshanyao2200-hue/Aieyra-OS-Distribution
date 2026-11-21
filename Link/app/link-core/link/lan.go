// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Link/app/link-core/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: lanService; lanCandidateLimit; LANCandidate; LANScan; validHex; validLANName; lanIP; lanTXTValue; candidatesFromEntry; lanBrowse; collectLAN; DiscoverLAN; lanAnnouncement; announcementFor; advertiseLAN
// Impact: python -B scripts/code-atlas.py show Link/app/link-core/link/lan.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package link

import (
	"context"
	"encoding/hex"
	"fmt"
	"net"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/libp2p/zeroconf/v2"
	"github.com/miekg/dns"
)

const lanService = "_aieyra-link._tcp"
const lanCandidateLimit = 32

// Broadcast records are hints, never authentication or proof of execution.
type LANCandidate struct {
	ID       string `json:"id"`
	HostID   string `json:"host_id"`
	Name     string `json:"name"`
	URL      string `json:"hub_url"`
	Pin      string `json:"tls_fingerprint"`
	Verified bool   `json:"verified"`
}

type LANScan struct {
	Source     string         `json:"source"`
	ObservedAt string         `json:"observed_at"`
	Candidates []LANCandidate `json:"candidates"`
}

func validHex(value string, size int) bool {
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == size && value == strings.ToLower(value)
}

func validLANName(name string) bool {
	return utf8.ValidString(name) && len(name) > 0 && len(name) <= 120 && strings.TrimSpace(name) != "" && !strings.ContainsFunc(name, unicode.IsControl)
}

func lanIP(ip net.IP) bool {
	// IPv6 link-local addresses need an interface scope that DNS-SD does not
	// provide here. Do not turn an ambiguous address into a connection target.
	return ip != nil && !ip.IsLoopback() && (ip.IsPrivate() && ip.IsGlobalUnicast() || ip.To4() != nil && ip.IsLinkLocalUnicast())
}

// zeroconf exposes DNS TXT presentation strings, including decimal escapes for
// UTF-8 bytes. Reuse the DNS codec to obtain the original bounded wire value.
func lanTXTValue(text string) (string, bool) {
	if len(text) > 4*255 {
		return "", false
	}
	rr := &dns.TXT{Hdr: dns.RR_Header{Name: ".", Rrtype: dns.TypeTXT, Class: dns.ClassINET}, Txt: []string{text}}
	var wire [267]byte // Root name, ten-byte RR header, one length byte, 255 bytes.
	end, err := dns.PackRR(rr, wire[:], 0, nil, false)
	if err != nil || end < 12 || int(wire[11])+12 != end {
		return "", false
	}
	return string(wire[12:end]), true
}

func candidatesFromEntry(entry *zeroconf.ServiceEntry) []LANCandidate {
	if entry == nil || entry.Port < 1 || entry.Port > 65535 || len(entry.Text) > 8 {
		return nil
	}
	fields := map[string]string{}
	for _, text := range entry.Text {
		decoded, valid := lanTXTValue(text)
		key, value, ok := strings.Cut(decoded, "=")
		_, duplicate := fields[key]
		if !valid || !ok || duplicate {
			return nil
		}
		fields[key] = value
	}
	if fields["protocol"] != protocol || !validHex(fields["id"], 16) || !validHex(fields["pin"], 32) || !validLANName(fields["name"]) {
		return nil
	}
	result := []LANCandidate{}
	for _, ip := range append(append([]net.IP{}, entry.AddrIPv4...), entry.AddrIPv6...) {
		if !lanIP(ip) {
			continue
		}
		endpoint := "https://" + net.JoinHostPort(ip.String(), strconv.Itoa(entry.Port))
		result = append(result, LANCandidate{ID: hash([]byte(fields["id"] + "\n" + fields["pin"] + "\n" + endpoint)), HostID: fields["id"], Name: fields["name"], URL: endpoint, Pin: fields["pin"]})
		if len(result) == lanCandidateLimit {
			break
		}
	}
	return result
}

type lanBrowse func(context.Context, chan<- *zeroconf.ServiceEntry) error

func collectLAN(ctx context.Context, duration time.Duration, browse lanBrowse) (LANScan, error) {
	result := LANScan{Source: "mdns", Candidates: []LANCandidate{}}
	if duration <= 0 || duration > 10*time.Second {
		return result, fmt.Errorf("LAN discovery timeout must be between zero and ten seconds")
	}
	window, cancel := context.WithTimeout(ctx, duration)
	defer cancel()
	entries := make(chan *zeroconf.ServiceEntry, 16)
	done := make(chan error, 1)
	go func() { done <- browse(window, entries) }()
	seen := map[string]bool{}
	accept := func(entry *zeroconf.ServiceEntry) {
		for _, candidate := range candidatesFromEntry(entry) {
			if !seen[candidate.ID] && len(result.Candidates) < lanCandidateLimit {
				seen[candidate.ID] = true
				result.Candidates = append(result.Candidates, candidate)
			}
		}
		if len(result.Candidates) == lanCandidateLimit {
			cancel()
		}
	}
	for {
		select {
		case entry, open := <-entries:
			if !open {
				entries = nil // The library owns channel closure.
			} else {
				accept(entry)
			}
		case err := <-done:
			// Browse may return before buffered announcements are consumed. It
			// does not close entries when opening the multicast socket fails.
			for entries != nil {
				select {
				case entry, open := <-entries:
					if !open {
						entries = nil
					} else {
						accept(entry)
					}
				default:
					entries = nil
				}
			}
			if ctx.Err() != nil {
				return result, ctx.Err()
			}
			if err != nil && window.Err() == nil {
				return result, fmt.Errorf("LAN discovery unavailable; check multicast networking")
			}
			sort.Slice(result.Candidates, func(i, j int) bool {
				if result.Candidates[i].Name == result.Candidates[j].Name {
					return result.Candidates[i].URL < result.Candidates[j].URL
				}
				return result.Candidates[i].Name < result.Candidates[j].Name
			})
			result.ObservedAt = now()
			return result, nil
		}
	}
}

func DiscoverLAN(ctx context.Context, duration time.Duration) (LANScan, error) {
	return collectLAN(ctx, duration, func(ctx context.Context, entries chan<- *zeroconf.ServiceEntry) error {
		return zeroconf.Browse(ctx, lanService, "local.", entries)
	})
}

type lanAnnouncement struct {
	IPs        []string
	Interfaces []net.Interface
	Port       int
	Text       []string
}

func announcementFor(identity Identity, listen net.Addr, interfaces []net.Interface, addresses func(net.Interface) ([]net.Addr, error)) (lanAnnouncement, error) {
	result := lanAnnouncement{}
	host, port, err := net.SplitHostPort(listen.String())
	if err != nil {
		return result, fmt.Errorf("invalid LAN listener")
	}
	bound := net.ParseIP(host)
	result.Port, err = strconv.Atoi(port)
	if err != nil || bound == nil || bound.IsLoopback() || result.Port < 1 || result.Port > 65535 || !validHex(identity.ID, 16) || !validHex(identity.TLSFingerprint, 32) || !validLANName(identity.Name) {
		return result, fmt.Errorf("LAN advertisement requires a TLS host bound to a local network interface")
	}
	seen := map[string]bool{}
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagMulticast == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		values, err := addresses(iface)
		if err != nil {
			continue
		}
		used := false
		for _, value := range values {
			ip, _, err := net.ParseCIDR(value.String())
			if err != nil || !lanIP(ip) || bound.To4() != nil && ip.To4() == nil || !bound.IsUnspecified() && !bound.Equal(ip) {
				continue
			}
			if !seen[ip.String()] && len(result.IPs) < lanCandidateLimit {
				seen[ip.String()] = true
				result.IPs = append(result.IPs, ip.String())
				used = true
			}
		}
		if used {
			result.Interfaces = append(result.Interfaces, iface)
		}
	}
	if len(result.IPs) == 0 {
		return result, fmt.Errorf("no reachable private LAN interface for advertisement")
	}
	// TXT packing interprets backslashes; preserve literal user name bytes.
	result.Text = []string{"protocol=" + protocol, "id=" + identity.ID, "pin=" + identity.TLSFingerprint, "name=" + strings.ReplaceAll(identity.Name, `\`, `\\`), "version=" + Version}
	return result, nil
}

func advertiseLAN(identity Identity, listen net.Addr) (*zeroconf.Server, error) {
	interfaces, err := net.Interfaces()
	if err != nil {
		return nil, err
	}
	value, err := announcementFor(identity, listen, interfaces, func(iface net.Interface) ([]net.Addr, error) { return iface.Addrs() })
	if err != nil {
		return nil, err
	}
	return zeroconf.RegisterProxy("Aieyra-"+identity.ID, lanService, "local.", value.Port, "aieyra-"+identity.ID+".local.", value.IPs, value.Text, value.Interfaces, zeroconf.TTL(60))
}
