import SimpleComparison from './SimpleComparison.jsx'
import { Async, Section } from './common.jsx'

export default function AnomSection({ summaryState }) {
  return <Section num={4} id="section-4" title="Are calls arriving on time?" tag="Geographic comparison">
    <Async state={summaryState}>{(d) => <SimpleComparison key={JSON.stringify(d.selection)} d={d} />}</Async>
  </Section>
}
