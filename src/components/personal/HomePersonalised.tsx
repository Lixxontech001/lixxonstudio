import ContinueReadingRail from './ContinueReadingRail';
import ForYouRail from './ForYouRail';

export default function HomePersonalised() {
  return (
    <div className="overflow-hidden">
      <ContinueReadingRail />
      <ForYouRail />
    </div>
  );
}
