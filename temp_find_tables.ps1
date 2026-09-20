$schema = Get-Content 'c:\Users\asus\Desktop\school-saas\supabase\migrations\20260909150000_canonical_accounting_foundation.sql' -Raw
$pattern = 'create table if not exists public\.(\w+)'
$matches = [regex]::Matches($schema, $pattern)
Write-Host "Tables in canonical accounting foundation:"
$tableNames = @()
foreach ($match in $matches) {
    $tableNames += $match.Groups[1].Value
    Write-Host "  - $($match.Groups[1].Value)"
}

# Find unique table names
$uniqueTables = $tableNames | Sort-Object -Unique
Write-Host "`nTotal unique tables: $($uniqueTables.Count)"
