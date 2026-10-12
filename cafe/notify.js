// 윈도우 알림(토스트). 브라우저 탭을 닫았거나 다른 창에서 작업 중이어도 화면 오른쪽 아래에 알림이 뜬다.
// 서버가 직접 띄우므로 웹페이지가 열려 있지 않아도 된다. 윈도우가 아니거나 실패하면 조용히 넘어간다.
const { spawn } = require('child_process');

// 제목·내용은 환경변수로 넘긴다 (명령줄에 넣으면 따옴표·한글 인코딩이 깨질 수 있다).
const SCRIPT = `
$ErrorActionPreference = 'Stop'
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$esc = { param($s) [System.Security.SecurityElement]::Escape($s) }
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml('<toast scenario="reminder"><visual><binding template="ToastGeneric"><text>' + (& $esc $env:CAFE_TOAST_TITLE) + '</text><text>' + (& $esc $env:CAFE_TOAST_BODY) + '</text></binding></visual><audio src="ms-winsoundevent:Notification.Default"/></toast>')
$toast = New-Object Windows.UI.Notifications.ToastNotification $xml
$appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
`;

/** onDone(성공 여부, 오류 내용) 은 확인용이다. */
function toast(title, body, onDone = () => {}) {
  if (process.platform !== 'win32') return onDone(false, 'windows 가 아닙니다');
  try {
    const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      env: { ...process.env, CAFE_TOAST_TITLE: String(title).slice(0, 80), CAFE_TOAST_BODY: String(body).slice(0, 200) },
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => onDone(false, e.message));
    child.on('close', (code) => onDone(code === 0, err.slice(0, 300)));
  } catch (e) {
    onDone(false, e.message); // 알림을 못 띄워도 작업에는 영향 없다
  }
}

module.exports = { toast };
