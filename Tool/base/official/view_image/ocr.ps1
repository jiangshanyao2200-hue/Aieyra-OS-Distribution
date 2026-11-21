$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Foundation, ContentType=WindowsRuntime]
$awaitMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
function Await-Operation($operation, [Type]$resultType) {
    $task = $awaitMethod.MakeGenericMethod($resultType).Invoke($null, @($operation))
    $task.GetAwaiter().GetResult()
}
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) {
    $language = [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | Select-Object -First 1
    if ($null -ne $language) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language) }
}
if ($null -eq $engine) { throw 'No installed OCR language' }
$data = [Convert]::FromBase64String([Console]::In.ReadToEnd())
$stream = [IO.MemoryStream]::new($data)
$random = [IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($stream)
$bitmap = $null
try {
    $decoder = Await-Operation ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($random)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $scale = [Math]::Min(1.0, [Windows.Media.Ocr.OcrEngine]::MaxImageDimension / [double][Math]::Max($decoder.PixelWidth, $decoder.PixelHeight))
    $transform = [Windows.Graphics.Imaging.BitmapTransform]::new()
    $transform.ScaledWidth = [uint32][Math]::Max(1, [Math]::Floor($decoder.PixelWidth * $scale))
    $transform.ScaledHeight = [uint32][Math]::Max(1, [Math]::Floor($decoder.PixelHeight * $scale))
    $bitmap = Await-Operation ($decoder.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied, $transform, [Windows.Graphics.Imaging.ExifOrientationMode]::IgnoreExifOrientation, [Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage)) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result = Await-Operation ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    $text = ($result.Lines | ForEach-Object { $_.Text }) -join "`n"
    if ($null -eq $text) { $text = '' }
    $truncated = $text.Length -gt 24000
    if ($truncated) { $text = $text.Substring(0, 24000); if ([char]::IsHighSurrogate($text[$text.Length-1])) { $text = $text.Substring(0, $text.Length-1) } }
    [ordered]@{ text=$text; language=$engine.RecognizerLanguage.LanguageTag; truncated=$truncated } | ConvertTo-Json -Compress
} finally {
    if ($null -ne $bitmap) { $bitmap.Dispose() }
    $random.Dispose()
    $stream.Dispose()
}
