/**
 * DEV SAMPLE. Invented rules for the /dev page and tests only. They are not
 * taken from any real standard or handbook, and must never be shown as one.
 */
import type { Rule } from '@/cartridge/types';

export const SAMPLE_RULES: readonly Rule[] = [
  {
    id: 'R001',
    title: 'Drinking water per person',
    when: 'Planning daily drinking water for a group of people',
    then: 'Provide at least 15 litres of water per person per day.',
    exceptions: [],
    severity: 'critical',
    keywords: ['water', 'litres', 'drinking', 'how much water', 'people', 'daily'],
    source: { section: 'Dev sample 1', quote: 'at least 15 litres of water per person per day' },
    calc: {
      op: 'multiply',
      factor: 15,
      inputLabel: 'people',
      inputUnit: 'people',
      outputLabel: 'water per day',
      outputUnit: 'litres',
      rounding: 'ceil',
    },
  },
  {
    id: 'R002',
    title: 'Toilets per number of people',
    when: 'Deciding how many toilets a site needs',
    notWhen: 'Asking about handwashing or water quantity',
    then: 'Provide one toilet for every 20 people.',
    exceptions: ['Short stays of under 3 days may use shared facilities.'],
    severity: 'major',
    keywords: ['toilets', 'latrines', 'how many toilets', 'sanitation', 'people'],
    source: { section: 'Dev sample 2', quote: 'one toilet for every 20 people' },
    calc: {
      op: 'divide',
      factor: 20,
      inputLabel: 'people',
      inputUnit: 'people',
      outputLabel: 'toilets',
      outputUnit: 'toilets',
      rounding: 'ceil',
    },
  },
  {
    id: 'R003',
    title: 'Handwashing near toilets',
    when: 'Setting up toilets or food areas',
    then: 'Place a handwashing station within reach of every toilet block.',
    exceptions: [],
    severity: 'minor',
    keywords: ['handwashing', 'soap', 'wash hands', 'hygiene', 'station'],
    source: {
      section: 'Dev sample 3',
      quote: 'a handwashing station within reach of every toilet block',
    },
  },
];
