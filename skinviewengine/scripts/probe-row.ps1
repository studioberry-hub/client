# Утилита диагностики: печатает RGB пикселей вдоль строки (Row) или столбца (Col) скриншота
param(
  [string]$Src,
  [int]$Row = -1,
  [int]$Col = -1,
  [int]$From = 0,
  [int]$To = -1
)
Add-Type -AssemblyName System.Drawing
$img = New-Object System.Drawing.Bitmap $Src
$limit = if ($Row -ge 0) { $img.Width } else { $img.Height }
if ($To -lt 0) { $To = $limit - 1 }
for ($i = $From; $i -le $To -and $i -lt $limit; $i++) {
  if ($Row -ge 0) { $p = $img.GetPixel($i, $Row); $label = "x=$i" }
  else { $p = $img.GetPixel($Col, $i); $label = "y=$i" }
  Write-Host ("{0}`t{1}`t{2}`t{3}" -f $label, $p.R, $p.G, $p.B)
}
$img.Dispose()
