// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/modules/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: version; parseVersion; compare; Satisfies
// Impact: python -B scripts/code-atlas.py show Core/modules/version.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package modules owns extension identity, compatibility and installation.
// It has no renderer, model-provider, or application-runtime dependency.
package modules

import (
	"fmt"
	"strconv"
	"strings"
)

type version [3]uint64

func parseVersion(s string) (version, error) {
	var out version
	parts := strings.Split(s, ".")
	if len(parts) != 3 {
		return out, fmt.Errorf("version must be three release numbers: %q", s)
	}
	for i, p := range parts {
		if p == "" || len(p) > 9 || len(p) > 1 && p[0] == '0' {
			return out, fmt.Errorf("invalid release version: %q", s)
		}
		for _, c := range p {
			if c < '0' || c > '9' {
				return out, fmt.Errorf("invalid release version: %q", s)
			}
		}
		v, e := strconv.ParseUint(p, 10, 32)
		if e != nil {
			return out, e
		}
		out[i] = v
	}
	return out, nil
}

func compare(a, b version) int {
	for i := range a {
		if a[i] < b[i] {
			return -1
		}
		if a[i] > b[i] {
			return 1
		}
	}
	return 0
}

// Satisfies implements exact, caret, tilde and space-separated comparisons.
// Pre-release, union and wildcard-component syntax are deliberately rejected.
func Satisfies(release, constraint string) (bool, error) {
	v, err := parseVersion(release)
	if err != nil {
		return false, err
	}
	terms := strings.Fields(constraint)
	if len(terms) == 0 || len(terms) > 8 {
		return false, fmt.Errorf("invalid version constraint: %q", constraint)
	}
	if constraint == "*" {
		return true, nil
	}
	matched := true
	for _, term := range terms {
		op := "="
		for _, prefix := range []string{">=", "<=", "^", "~", ">", "<", "="} {
			if strings.HasPrefix(term, prefix) {
				op, term = prefix, strings.TrimPrefix(term, prefix)
				break
			}
		}
		want, e := parseVersion(term)
		if e != nil {
			return false, e
		}
		c := compare(v, want)
		ok := false
		switch op {
		case "=":
			ok = c == 0
		case ">=":
			ok = c >= 0
		case "<=":
			ok = c <= 0
		case ">":
			ok = c > 0
		case "<":
			ok = c < 0
		case "^", "~":
			upper := want
			if op == "~" {
				upper[1]++
				upper[2] = 0
			} else if want[0] > 0 {
				upper = version{want[0] + 1, 0, 0}
			} else if want[1] > 0 {
				upper = version{0, want[1] + 1, 0}
			} else {
				upper[2]++
			}
			ok = c >= 0 && compare(v, upper) < 0
		}
		matched = matched && ok
	}
	return matched, nil
}
