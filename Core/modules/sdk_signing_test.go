// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/modules/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestSDKSignaturesMatchCoreForEverySampleAndOptionalFields
// Impact: python -B scripts/code-atlas.py show Core/modules/sdk_signing_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package modules

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestSDKSignaturesMatchCoreForEverySampleAndOptionalFields(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal("Node is required for SDK/Core signing interoperability", err)
	}
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	directory := t.TempDir()
	script := `const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
 const [root,out]=process.argv.slice(1),{pack}=require(path.join(root,'SDK/tools/package.cjs'));
 const key=path.join(out,'author.pem');fs.writeFileSync(key,crypto.generateKeyPairSync('ed25519').privateKey.export({format:'pem',type:'pkcs8'}));
 const source=path.join(root,'SDK/examples');
 for(const name of fs.readdirSync(source)){
  if(!fs.existsSync(path.join(source,name,'manifest.json')))continue;
  const target=path.join(out,name);fs.cpSync(path.join(source,name),target,{recursive:true});pack(target,key);
 }
 for(const empty of [false,true]){
  const target=path.join(out,empty?'empty-presentation':'unicode-order');fs.cpSync(path.join(source,'program-notebook'),target,{recursive:true});
  const file=path.join(target,'manifest.json'),m=JSON.parse(fs.readFileSync(file,'utf8'));
  m.summary='Signing <&> \u2028 \u2029 🪶';delete m.capabilities;delete m.permissions;
  m.dependencies=[{id:'example.optional',version:'^1.0.0',optional:false},{id:'example.null',version:'^1.0.0',optional:null},{id:'example.kept',version:'^1.0.0',optional:true}];
  m.presentation=empty?{}:{desktop:{renderer:'aieyra.program',contract:'1.0.0',entry:''}};
  fs.writeFileSync(file,JSON.stringify(m));
  for(const name of ['2','10','\ue000.txt','\u{10000}.txt'])fs.writeFileSync(path.join(target,name),'asset');
  pack(target,key);
 }`
	if out, err := exec.Command(node, "-e", script, root, directory).CombinedOutput(); err != nil {
		t.Fatalf("SDK pack: %v %s", err, out)
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		t.Run(entry.Name(), func(t *testing.T) {
			p, err := Load(context.Background(), filepath.Join(directory, entry.Name()))
			if err != nil {
				t.Fatal(err)
			}
			if key, err := p.Manifest.PublisherKey(); err != nil || key == "unsigned" {
				t.Fatal("missing verified publisher", err)
			}
			// The signed manifest must survive the same typed serialization used by the
			// installed registry, including omission of empty optional fields.
			raw, err := json.Marshal(p.Manifest)
			if err != nil {
				t.Fatal(err)
			}
			m, err := DecodeManifest(raw)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = m.PublisherKey(); err != nil {
				t.Fatal("registry reload broke signature", err)
			}
			m.Name += " tampered"
			if _, err = m.PublisherKey(); err == nil {
				t.Fatal("signed metadata can be changed")
			}
		})
	}
}
