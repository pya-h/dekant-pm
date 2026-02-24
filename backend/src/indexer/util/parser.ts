import { BorshCoder, EventParser, Event } from '@coral-xyz/anchor';
import { IDL } from '../../common/idl';

let eventParser: EventParser | null = null;

function getEventParser(): EventParser {
  if (!eventParser) {
    const coder = new BorshCoder(IDL as any);
    eventParser = new EventParser(
      undefined as any, // programId not needed for parsing
      coder,
    );
  }
  return eventParser;
}

export interface ParsedEvent {
  name: string;
  data: Record<string, any>;
}

export function parseEventsFromLogs(logs: string[]): ParsedEvent[] {
  const parser = getEventParser();
  const events: ParsedEvent[] = [];

  for (const event of parser.parseLogs(logs)) {
    events.push({
      name: event.name,
      data: event.data as Record<string, any>,
    });
  }

  return events;
}
