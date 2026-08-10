# Диагностика швов: считает «тёмные точки» (пиксель заметно темнее горизонтальных соседей)
# в заданной области для каждого скриншота эксперимента.
param(
  [string]$Dir = "scripts/out",
  [int]$X = 110, [int]$Y = 90, [int]$W = 200, [int]$H = 320,
  [int]$Delta = 30
)
Add-Type -AssemblyName System.Drawing
foreach ($f in Get-ChildItem -Path $Dir -Filter *.png | Sort-Object Name) {
  $img = New-Object System.Drawing.Bitmap $f.FullName
  $count = 0
  $sum = 0
  for ($j = $Y; $j -lt [Math]::Min($Y + $H, $img.Height); $j++) {
    for ($i = $X + 2; $i -lt [Math]::Min($X + $W, $img.Width) - 2; $i++) {
      $c = $img.GetPixel($i, $j)
      $l = 0.299 * $c.R + 0.587 * $c.G + 0.114 * $c.B
      # интересуют только освещённые поверхности, фон/чёрную текстуру пропускаем
      if ($l -lt 60) { continue }
      $a = $img.GetPixel($i - 2, $j); $la = 0.299 * $a.R + 0.587 * $a.G + 0.114 * $a.B
      $b = $img.GetPixel($i + 2, $j); $lb = 0.299 * $b.R + 0.587 * $b.G + 0.114 * $b.B
      if ($la - $l -gt $Delta -and $lb - $l -gt $Delta) {
        $count++
        $sum += (($la + $lb) / 2 - $l)
      }
    }
  }
  $avg = if ($count -gt 0) { [Math]::Round($sum / $count, 1) } else { 0 }
  Write-Host ("{0,-28} darkDots={1,5}  avgDrop={2}" -f $f.Name, $count, $avg)
  $img.Dispose()
}
