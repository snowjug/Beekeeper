param(
  [Parameter(Mandatory = $true)][string]$Text,
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$LeadMs = 700
)

# Synthesises speech with the installed Windows voice into a 16 kHz mono WAV, preceded by silence.
# Used by the E2E tests as a fake microphone input (Chromium --use-file-for-fake-audio-capture).
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
    16000,
    [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
    [System.Speech.AudioFormat.AudioChannel]::Mono)
  $synth.SetOutputToWaveFile($Out, $format)
  $escaped = [System.Security.SecurityElement]::Escape($Text)
  $synth.SpeakSsml("<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><break time='${LeadMs}ms'/>$escaped</speak>")
} finally {
  $synth.Dispose()
}
