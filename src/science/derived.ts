/* Fill every data-v hook in the copy from the model, so the prose can't drift. */
import * as S from './membrane'

const fmt = (n: number, d = 0) => n.toLocaleString('en-GB', { maximumFractionDigits: d, minimumFractionDigits: d }).replace(/,/g, ' ')
const sign = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n))

export function fillNumbers(lipids = 10000) {
  const v: Record<string, string> = {
    thick: `${S.THICK_NM[0]}–${S.THICK_NM[1]}`,
    rbcRatio: fmt(S.rbcRatio),
    lipids: fmt(Math.round(lipids / 100) * 100),
    t10um: S.fmtTime(S.diffTime(10e-6)),
    t1mm: S.fmtTime(S.diffTime(1e-3)),
    t1cm: S.fmtTime(S.diffTime(1e-2)),
    lyseMosm: fmt(Math.round(S.lyseMosm / 5) * 5),
    lyseV: fmt(S.RBC_LYSE, 1),
    saline: fmt(Math.round(S.salineMosm(0.9))),
    fish: fmt(S.FISH_ENERGY),
    vrest: sign(S.V_REST),
    vrestT: `${sign(S.V_REST)} mV`,
    eNa: sign(Math.round(S.E_NA)),
    eK: sign(Math.round(S.E_K)),
    pumpWork: fmt(Math.round(S.PUMP_WORK)),
    atpDG: fmt(S.ATP_DG),
    symNa: fmt(Math.round(S.SYM_NA)),
    symGlu: fmt(Math.round(S.SYM_GLU)),
  }
  document.querySelectorAll<HTMLElement>('[data-v]').forEach((el) => {
    const k = el.dataset.v!
    if (k in v) el.textContent = v[k]
  })
}
