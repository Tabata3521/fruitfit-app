$secure = Read-Host "Paste OPENAI_API_KEY" -AsSecureString
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
$envPath = Join-Path $PSScriptRoot "..\.env"
$modelLine = "OPENAI_MODEL=gpt-5-nano"
$keyLine = "OPENAI_API_KEY=$plain"
Set-Content -Path $envPath -Value @($keyLine, $modelLine) -Encoding UTF8
Write-Host "Saved OPENAI_API_KEY and OPENAI_MODEL to .env"
