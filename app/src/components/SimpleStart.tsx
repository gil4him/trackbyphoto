/**
 * Simple edition, family member with no parent linked yet: Home is just
 * the one thing to do first and how it goes. No camera, no own records —
 * in the simple edition only the parent takes photos.
 */
export function SimpleStart({ name, onConnect }: { name: string; onConnect: () => void }) {
  return (
    <section className="page home simple-start" aria-label="시작하기">
      <div className="home-hi">
        <div className="t">{name}님, 안녕하세요</div>
        <div className="sub">엄마의 오늘을 사진으로 받아보세요</div>
      </div>
      <ol className="simple-start-steps">
        <li><b>엄마 연결하기</b>를 눌러요</li>
        <li>카카오톡으로 엄마에게 링크를 보내요</li>
        <li>엄마가 찍은 사진이 여기에 와요</li>
      </ol>
      <button className="pair-btn simple-start-go" onClick={onConnect}>엄마 연결하기</button>
    </section>
  )
}
