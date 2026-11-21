// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: imageGenRequest; imageEditInput; imageGenError; imageGenFunc; generatedImageByteLimit; imageEditByteLimit; generatedImage; imageGenFailure; imageGenResult; imageBatchInput; imageBatchItem; imageBatchSummary
// Impact: python -B scripts/code-atlas.py show Core/image_contracts.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"github.com/aieyra/aieyra-os/contracts/protocol"
	imagecontract "github.com/aieyra/aieyra-os/tool/toolbox/official/imagegen/contract"
)

type imageGenRequest = protocol.ImageRequest
type imageEditInput = protocol.ImageEditInput
type imageGenError = protocol.ImageProviderError
type imageGenFunc func(context.Context, imageGenRequest) ([]byte, error)

const generatedImageByteLimit = protocol.GeneratedImageByteLimit
const imageEditByteLimit = protocol.ImageEditByteLimit

type generatedImage = imagecontract.Image
type imageGenFailure = imagecontract.Failure
type imageGenResult = imagecontract.Result
type imageBatchInput = imagecontract.BatchInput
type imageBatchItem = imagecontract.BatchItem
type imageBatchSummary = imagecontract.BatchSummary
