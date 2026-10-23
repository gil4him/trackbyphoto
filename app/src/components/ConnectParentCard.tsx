/**
 * Simple edition, family member with no parent linked yet: the one thing to
 * do first, alone on Home. Opens 엄마 연결하기 (RegisterElder).
 *
 * A parent who signed in with Google by mistake lands here too (parents never
 * sign in; their phone is linked by the family's QR or link). `onImParent`
 * signs out and opens the parent's way in.
 */
export function ConnectParentCard({ onOpen, onImParent }: { onOpen: () => void; onImParent?: () => void }) {
  return (
    <div className="connect-card" role="note">
      <div className="connect-icon" aria-hidden="true">📷</div>
      <p className="connect-msg">엄마 휴대폰을 연결하면<br />엄마가 찍은 사진이 여기에 와요</p>
      <button type="button" className="connect-btn" onClick={onOpen}>엄마 연결하기</button>
      {onImParent && (
        <div className="connect-parent">
          <p className="connect-parent-msg">부모님이신가요? 이 계정은 가족용이에요.<br />가족에게 받은 연결 링크로 들어오세요.</p>
          <button type="button" className="signin-code-btn" onClick={onImParent}>부모님 휴대폰이에요</button>
        </div>
      )}
    </div>
  )
}
