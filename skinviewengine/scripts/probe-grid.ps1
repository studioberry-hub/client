# Утилита диагностики: печатает сетку яркости (luma) для прямоугольной области скриншота
param(
  [string]$Src,
  [int]$X, [int]$Y, [int]$W, [int]$H
)
Add-Type -AssemblyName System.Drawing
$img = New-Object System.Drawing.Bitmap $Src
$header = "      "
for ($i = 0; $i -lt $W; $i++) { $header += ("{0,4}" -f ($X + $i)) }
Write-Host $header
for ($j = 0; $j -lt $H; $j++) {
  $line = "{0,5} " -f ($Y + $j)
  for ($i = 0; $i -lt $W; $i++) {
    $p = $img.GetPixel($X + $i, $Y + $j)
    $luma = [int](0.299 * $p.R + 0.587 * $p.G + 0.114 * $p.B)
    $line += ("{0,4}" -f $luma)
  }
  Write-Host $line
}
$img.Dispose()
