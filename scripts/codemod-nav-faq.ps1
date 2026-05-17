# PR-1 codemod: strip inline FAQ + nav-dropdown onclick attributes,
# inject <script src="/assets/js/nav-faq.js" defer></script> before </head>.
# Idempotent: re-running on already-converted files leaves them unchanged.

param(
  [string]$Repo = (Resolve-Path "$PSScriptRoot\..").Path,
  [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'

$dirs = @(
  (Join-Path $Repo 'docs\*.html'),
  (Join-Path $Repo 'docs\areas'),
  (Join-Path $Repo 'docs\blog'),
  (Join-Path $Repo 'docs\services'),
  (Join-Path $Repo 'docs\the-pledge'),
  (Join-Path $Repo 'docs\free-guide'),
  (Join-Path $Repo 'docs\free-roof')
)
$files = @()
foreach ($d in $dirs) {
  if ($d -like '*.html') {
    $files += Get-ChildItem -Path $d -ErrorAction SilentlyContinue
  } elseif (Test-Path $d) {
    $files += Get-ChildItem -Path $d -Recurse -Filter *.html -ErrorAction SilentlyContinue
  }
}

$faqAttr = @'
 onclick="this.parentElement.classList.toggle('open')"
'@

$navAttr = @'
 onclick="if(window.innerWidth&gt;900){event.preventDefault();var p=this.parentElement;var wasOpen=p.classList.contains(&apos;open&apos;);document.querySelectorAll(&apos;.nav-links .dropdown.open&apos;).forEach(function(d){d.classList.remove(&apos;open&apos;)});if(!wasOpen)p.classList.add(&apos;open&apos;);this.blur()}"
'@

$scriptTag = '<script src="/assets/js/nav-faq.js" defer></script>'
$scriptLine = "  " + $scriptTag + "`r`n"

$filesScanned = 0
$filesChanged = 0
$faqStripped = 0
$navStripped = 0
$scriptInjected = 0
$alreadyHadScript = 0

foreach ($f in $files) {
  $filesScanned++
  $orig = [System.IO.File]::ReadAllText($f.FullName)
  $text = $orig

  $faqCount = 0
  while ($text.Contains($faqAttr)) {
    $text = $text.Replace($faqAttr, '')
    $faqCount++
  }
  $faqStripped += $faqCount

  $navCount = 0
  while ($text.Contains($navAttr)) {
    $text = $text.Replace($navAttr, '')
    $navCount++
  }
  $navStripped += $navCount

  $needsScript = ($faqCount + $navCount) -gt 0 -or $text.Contains('<li class="dropdown"><a href="/#services"') -or $text.Contains('class="faq-q"')

  if ($text.Contains('/assets/js/nav-faq.js')) {
    $alreadyHadScript++
  } elseif ($needsScript) {
    $idx = $text.IndexOf('</head>')
    if ($idx -lt 0) {
      Write-Warning ("No </head> in " + $f.FullName)
    } else {
      $text = $text.Substring(0, $idx) + $scriptLine + $text.Substring($idx)
      $scriptInjected++
    }
  }

  if ($text -ne $orig) {
    $filesChanged++
    if (-not $WhatIf) {
      [System.IO.File]::WriteAllText($f.FullName, $text)
    }
  }
}

"FilesScanned     $filesScanned"
"FilesChanged     $filesChanged"
"FaqStripped      $faqStripped"
"NavStripped      $navStripped"
"ScriptInjected   $scriptInjected"
"AlreadyHadScript $alreadyHadScript"
