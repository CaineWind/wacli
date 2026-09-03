param(
  [string]$Source = "public/icons/new.png"
)

$ErrorActionPreference = "Stop"
$sizes = @(72, 96, 128, 144, 152, 180, 192, 384, 512)

foreach ($size in $sizes) {
  ffmpeg -hide_banner -loglevel error -y -i $Source `
    -vf "scale=${size}:${size}:flags=lanczos,format=rgba" `
    -frames:v 1 "public/icons/icon-${size}x${size}.png"
  if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed to generate ${size}x${size} icon" }
}

foreach ($size in @(192, 512)) {
  ffmpeg -hide_banner -loglevel error -y `
    -f lavfi -i "color=c=0x111111:s=${size}x${size}" -i $Source `
    -filter_complex "[1:v]scale=${size}:${size}:flags=lanczos,format=rgba[fg];[0:v][fg]overlay=0:0:format=auto,format=rgb24[out]" `
    -map "[out]" -frames:v 1 "public/icons/icon-maskable-${size}x${size}.png"
  if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed to generate ${size}x${size} maskable icon" }
}

foreach ($asset in @(
  @{ Size = 32; Path = "public/favicon.png" },
  @{ Size = 128; Path = "public/logo-128.png" },
  @{ Size = 256; Path = "public/logo-256.png" }
)) {
  $size = $asset.Size
  ffmpeg -hide_banner -loglevel error -y -i $Source `
    -vf "scale=${size}:${size}:flags=lanczos,format=rgba" `
    -frames:v 1 $asset.Path
  if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed to generate $($asset.Path)" }
}
