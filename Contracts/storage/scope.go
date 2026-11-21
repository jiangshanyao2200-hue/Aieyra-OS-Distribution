// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Contracts/storage/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: resourceScope; Use; Active
// Impact: python -B scripts/code-atlas.py show Contracts/storage/scope.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package storage

import (
	"fmt"
	"sync"
)

// ResourceScope belongs to a process entrypoint, never to a path getter or
// configuration load. It prevents concurrent hosts from mixing private prompts.
var resourceScope struct {
	sync.Mutex
	profile Profile
	users   int
}

func Use(config string) (func(), error) {
	p, err := Bind(config)
	if err != nil {
		return nil, err
	}
	resourceScope.Lock()
	defer resourceScope.Unlock()
	if resourceScope.users > 0 && pathKey(resourceScope.profile.Config) != pathKey(p.Config) {
		return nil, fmt.Errorf("another user-data profile owns this process; open a separate process")
	}
	releaseOwner, err := enterProfile(p)
	if err != nil {
		return nil, err
	}
	resourceScope.profile = p
	resourceScope.users++
	var once sync.Once
	return func() {
		once.Do(func() {
			resourceScope.Lock()
			defer resourceScope.Unlock()
			releaseOwner()
			resourceScope.users--
			if resourceScope.users == 0 {
				resourceScope.profile = Profile{}
			}
		})
	}, nil
}

func Active() (Profile, bool) {
	resourceScope.Lock()
	defer resourceScope.Unlock()
	return resourceScope.profile, resourceScope.users > 0
}
