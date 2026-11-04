(Get-Content d:/School-sas-master/School-sas-master/src/app/accounting/receipt/page.tsx -Raw) -Replace "`r`n", "`n" | Select-String 'const html' | ForEach-Object {
  $line = $_.Line
  $idx = $line.IndexOf("const html", [StringComparison]::Ordinal)
  if ($idx -ge 0) {
    $sub = $line.Substring($idx, 80)
    $bytes = [byte[]][char[]]$sub
    $hex = ($bytes | ForEach-Object { $_.ToString("X2") }) -join " "
    Write-Host "MATCH $idx HEX=$hex"
    Write-Host "TEXT=[$sub]"
  }
}