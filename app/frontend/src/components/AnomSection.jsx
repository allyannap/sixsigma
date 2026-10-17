import SimpleComparison from './SimpleComparison.jsx'
import { Async, ChartCard } from './common.jsx'

/** Chart card 1: the geographic comparison (Kelly's SimpleComparison, unchanged). */
export default function AnomSection({ summaryState }) {
  return (
    <ChartCard id="section-4" title="Are calls arriving on time?" sub="Each area's on-time rate against the service goal" tag="Geographic comparison">
      <Async state={summaryState}>{(d) => <SimpleComparison key={JSON.stringify(d.selection)} d={d} />}</Async>
    </ChartCard>
  )
}
