/**
 * Simple edition, family member with no parent linked yet: the one thing to
 * do first, on Home. Opens 엄마 연결하기 (RegisterElder).
 */
export function ConnectParentCard({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="install-hint" role="note">
      <span className="install-msg">엄마 휴대폰을 연결하면 엄마가 찍은 사진이 여기에 와요</span>
      <button className="install-go" onClick={onOpen}>엄마 연결하기</button>
    </div>
  )
}
