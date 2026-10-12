/**
 * Simple edition, family member with no parent linked yet: the one thing to
 * do first, alone on Home. Opens 엄마 연결하기 (RegisterElder).
 */
export function ConnectParentCard({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="connect-card" role="note">
      <div className="connect-icon" aria-hidden="true">📷</div>
      <p className="connect-msg">엄마 휴대폰을 연결하면<br />엄마가 찍은 사진이 여기에 와요</p>
      <button type="button" className="connect-btn" onClick={onOpen}>엄마 연결하기</button>
    </div>
  )
}
