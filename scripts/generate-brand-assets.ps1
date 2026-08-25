# Regenerates the PWA icon set and the static OG share cards (GDI+, no deps).
# The glyph/color must match src/components/BrandMark.tsx — rerun this script
# whenever the brand mark changes. Run: powershell -File scripts/generate-brand-assets.ps1
Add-Type -AssemblyName System.Drawing

$brand = [System.Drawing.ColorTranslator]::FromHtml("#1cc29f")
$white = [System.Drawing.Color]::White
$glyph = [char]0x20AC  # EUR sign — keep in sync with BRAND_GLYPH

function New-Canvas([int]$w, [int]$h) {
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = "AntiAlias"
  $g.TextRenderingHint = "AntiAliasGridFit"
  return @($bmp, $g)
}

function Add-RoundedRect($g, $brush, [float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  $g.FillPath($brush, $path)
  $path.Dispose()
}

function Add-CenteredGlyph($g, [int]$size, [float]$fontFrac) {
  $font = New-Object System.Drawing.Font("Segoe UI", ($size * $fontFrac), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = "Center"; $fmt.LineAlignment = "Center"
  $rect = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
  $g.DrawString([string]$glyph, $font, [System.Drawing.Brushes]::White, $rect, $fmt)
  $font.Dispose(); $fmt.Dispose()
}

function New-Icon([int]$size, [string]$path, [bool]$rounded, [float]$fontFrac) {
  $c = New-Canvas $size $size
  $bmp = $c[0]; $g = $c[1]
  $brush = New-Object System.Drawing.SolidBrush($brand)
  if ($rounded) {
    $g.Clear([System.Drawing.Color]::Transparent)
    Add-RoundedRect $g $brush 0 0 $size $size ($size * 0.22)
  } else {
    $g.Clear($brand)
  }
  Add-CenteredGlyph $g $size $fontFrac
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose(); $brush.Dispose()
  Write-Host "wrote $path"
}

# Icons: rounded artwork for `any`, full-bleed + smaller glyph (mask safe
# zone) for maskable, opaque square for apple-touch (iOS rounds it itself).
New-Icon 192 "public/icon-192.png" $true 0.62
New-Icon 512 "public/icon-512.png" $true 0.62
New-Icon 512 "public/icon-maskable-512.png" $false 0.46
New-Icon 180 "public/apple-touch-icon.png" $false 0.62

# OG cards (1200x630): brand ground, white tile with the glyph, name, the
# three-punch positioning line, domain. Keep each file well under 300 KB
# (Viber is aggressive about large previews).
function New-OgCard([string]$path, [string]$punch, [string]$domain) {
  $c = New-Canvas 1200 630
  $bmp = $c[0]; $g = $c[1]
  $g.Clear($brand)
  $whiteBrush = New-Object System.Drawing.SolidBrush($white)
  Add-RoundedRect $g $whiteBrush 80 80 120 120 26
  $glyphFont = New-Object System.Drawing.Font("Segoe UI", 78, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $brandBrush = New-Object System.Drawing.SolidBrush($brand)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = "Center"; $fmt.LineAlignment = "Center"
  $g.DrawString([string]$glyph, $glyphFont, $brandBrush, (New-Object System.Drawing.RectangleF(80, 80, 120, 120)), $fmt)

  $titleFont = New-Object System.Drawing.Font("Segoe UI", 92, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $g.DrawString("Money Assistant", $titleFont, $whiteBrush, 74, 250)
  $punchFont = New-Object System.Drawing.Font("Segoe UI", 44, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $g.DrawString($punch, $punchFont, $whiteBrush, (New-Object System.Drawing.RectangleF(80, 400, 1040, 140)))
  $domFont = New-Object System.Drawing.Font("Segoe UI", 30, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $domBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(220, 255, 255, 255))
  $domFmt = New-Object System.Drawing.StringFormat
  $domFmt.Alignment = "Far"
  $g.DrawString($domain, $domFont, $domBrush, (New-Object System.Drawing.RectangleF(80, 560, 1040, 50)), $domFmt)

  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Host "wrote $path"
}

New-Item -ItemType Directory -Force "public/og" | Out-Null
New-OgCard "public/og/card-bg.png" "Неограничени разходи. Безплатно сканиране на бонове. Без реклами." "money-assistant"
New-OgCard "public/og/card-en.png" "Unlimited expenses. Free receipt scanning. No ads." "money-assistant"
