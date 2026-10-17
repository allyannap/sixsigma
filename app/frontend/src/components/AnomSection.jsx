import SimpleComparison from './SimpleComparison.jsx'
import { Async, ChartCard } from './common.jsx'

/** Geographic comparison follows the map selection; supporting evidence opens in its drawer. */
export default function AnomSection({ summaryState, selected, onPick }) {
  return (
    <ChartCard id="section-4" title="Are calls arriving on time?" sub="Each area's on-time rate against the service goal" tag="Geographic comparison">
      <Async state={summaryState}>{(d) => <SimpleComparison key={JSON.stringify(d.selection)} d={d} selectedArea={selected} onPick={onPick} />}</Async>
    </ChartCard>
  )
}
