import type { Card } from '@shared/cards';
import {
  AnswerCardView,
  CalculationCardView,
  ConversionCardView,
  ScreenshotCardView,
  SearchCardView,
  StatusCardView,
  TextCardView,
  TimeCardView,
} from './simple';
import { ConfirmCardView, GalleryCardView, NotesCardView } from './lists';
import { BatteryCardView, DefinitionCardView, SystemInfoCardView } from './system';
import { CountdownCardView, TimerCardView } from './timers';
import { WeatherCardView } from './WeatherCardView';

/** Renders any card the command engine can produce. */
export function CardView({ card, index }: { card: Card; index: number }) {
  switch (card.kind) {
    case 'text':
      return <TextCardView card={card} index={index} />;
    case 'answer':
      return <AnswerCardView card={card} index={index} />;
    case 'status':
      return <StatusCardView card={card} index={index} />;
    case 'time':
      return <TimeCardView card={card} index={index} />;
    case 'weather':
      return <WeatherCardView card={card} index={index} />;
    case 'battery':
      return <BatteryCardView card={card} index={index} />;
    case 'sysinfo':
      return <SystemInfoCardView card={card} index={index} />;
    case 'calc':
      return <CalculationCardView card={card} index={index} />;
    case 'conversion':
      return <ConversionCardView card={card} index={index} />;
    case 'definition':
      return <DefinitionCardView card={card} index={index} />;
    case 'timer':
      return <TimerCardView card={card} index={index} />;
    case 'notes':
      return <NotesCardView card={card} index={index} />;
    case 'gallery':
      return <GalleryCardView card={card} index={index} />;
    case 'confirm':
      return <ConfirmCardView card={card} index={index} />;
    case 'countdown':
      return <CountdownCardView card={card} index={index} />;
    case 'search':
      return <SearchCardView card={card} index={index} />;
    case 'screenshot':
      return <ScreenshotCardView card={card} index={index} />;
  }
}
