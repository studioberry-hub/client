# Утилита диагностики: вырезает область скриншота и увеличивает nearest-neighbor
param(
  [string]$Src,
  [string]$Dst,
  [int]$X, [int]$Y, [int]$W, [int]$H, [int]$Scale = 6
)
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile($Src)
Write-Host "source size: $($img.Width)x$($img.Height)"
$out = New-Object System.Drawing.Bitmap ($W * $Scale), ($H * $Scale)
$g = [System.Drawing.Graphics]::FromImage($out)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
$g.DrawImage($img, (New-Object System.Drawing.Rectangle 0, 0, ($W * $Scale), ($H * $Scale)), (New-Object System.Drawing.Rectangle $X, $Y, $W, $H), [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()
$out.Save($Dst, [System.Drawing.Imaging.ImageFormat]::Png)
$out.Dispose()
$img.Dispose()
Write-Host "saved $Dst"
