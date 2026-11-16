/**
 * TEST ONLY. An invented rulebook and the cartridge made from it, used as
 * fixtures by automated tests. Not taken from any real standard; never used
 * by the app (ESLint blocks importing src/testing from app code).
 */
import { joinPages, type SourceText } from '@/cartridge/source';
import type { Cartridge, Rule } from '@/cartridge/types';

export const FIELD_PAGES: readonly string[] = [
  'Water supply\n\nProvide at least 15 litres of water per person per day for drinking, cooking and personal hygiene.\n\nWater points must be no more than 500 metres from any household.\n\nFree residual chlorine must be at least 0.5 mg per litre at the tap.',
  'Sanitation\n\nProvide one toilet for every 20 people. Short stays of under 3 days may use shared facilities.\n\nToilets must be at least 30 metres from any groundwater source.',
  'Hygiene\n\nPlace a handwashing station within reach of every toilet block.\n\nProvide 250 grams of bathing soap per person per month.',
  'Shelter\n\nProvide at least 3.5 square metres of covered living space per person.',
];

export const FIELD_SOURCE: SourceText = joinPages(FIELD_PAGES);

const r = (rule: Rule): Rule => rule;

export const FIELD_RULES: readonly Rule[] = [
  r({
    id: 'R001',
    title: 'Drinking water per person',
    when: 'Planning how much water a group of people needs each day',
    then: 'Provide at least 15 litres of water per person per day.',
    exceptions: [],
    severity: 'critical',
    keywords: [
      'water',
      'litres',
      'drinking water',
      'how much water',
      'water per day',
      'daily water',
    ],
    source: {
      section: 'Water supply',
      page: 1,
      quote: 'Provide at least 15 litres of water per person per day',
    },
    calc: {
      op: 'multiply',
      factor: 15,
      inputLabel: 'people',
      inputUnit: 'people',
      outputLabel: 'water per day',
      outputUnit: 'litres',
      rounding: 'ceil',
    },
  }),
  r({
    id: 'R002',
    title: 'Distance to a water point',
    when: 'Choosing where to put water points',
    then: 'Keep water points no more than 500 metres from any household.',
    exceptions: [],
    severity: 'major',
    keywords: ['water point', 'tap stand', 'how far', 'distance', 'walk to water', 'metres'],
    source: {
      section: 'Water supply',
      page: 1,
      quote: 'Water points must be no more than 500 metres from any household.',
    },
  }),
  r({
    id: 'R003',
    title: 'Chlorine level at the tap',
    when: 'Checking whether piped water is safe to drink',
    then: 'Free residual chlorine must be at least 0.5 mg per litre at the tap.',
    exceptions: [],
    severity: 'critical',
    keywords: [
      'chlorine',
      'water testing',
      'safe to drink',
      'disinfection',
      'tap water',
      'residual',
    ],
    source: {
      section: 'Water supply',
      page: 1,
      quote: 'Free residual chlorine must be at least 0.5 mg per litre at the tap.',
    },
  }),
  r({
    id: 'R004',
    title: 'Toilets per number of people',
    when: 'Deciding how many toilets a site needs',
    notWhen: 'Asking how far toilets must be from water',
    then: 'Provide one toilet for every 20 people.',
    exceptions: ['Short stays of under 3 days may use shared facilities.'],
    severity: 'major',
    keywords: [
      'toilets',
      'latrines',
      'how many toilets',
      'sanitation',
      'toilet count',
      'people per toilet',
    ],
    source: { section: 'Sanitation', page: 2, quote: 'Provide one toilet for every 20 people.' },
    calc: {
      op: 'divide',
      factor: 20,
      inputLabel: 'people',
      inputUnit: 'people',
      outputLabel: 'toilets',
      outputUnit: 'toilets',
      rounding: 'ceil',
    },
  }),
  r({
    id: 'R005',
    title: 'Toilet distance from groundwater',
    when: 'Choosing where to dig toilets or latrines',
    then: 'Keep toilets at least 30 metres from any groundwater source.',
    exceptions: [],
    severity: 'critical',
    keywords: [
      'groundwater',
      'well',
      'borehole',
      'latrine location',
      'contamination',
      'toilet distance',
    ],
    source: {
      section: 'Sanitation',
      page: 2,
      quote: 'Toilets must be at least 30 metres from any groundwater source.',
    },
  }),
  r({
    id: 'R006',
    title: 'Handwashing near toilets',
    when: 'Setting up toilet blocks',
    then: 'Place a handwashing station within reach of every toilet block.',
    exceptions: [],
    severity: 'minor',
    keywords: ['handwashing', 'wash hands', 'hand washing station', 'hygiene', 'basin'],
    source: {
      section: 'Hygiene',
      page: 3,
      quote: 'Place a handwashing station within reach of every toilet block.',
    },
  }),
  r({
    id: 'R007',
    title: 'Bathing soap per person',
    when: 'Planning hygiene supplies for a month',
    then: 'Provide 250 grams of bathing soap per person per month.',
    exceptions: [],
    severity: 'minor',
    keywords: ['soap', 'bathing soap', 'hygiene kit', 'grams of soap', 'monthly supplies'],
    source: {
      section: 'Hygiene',
      page: 3,
      quote: 'Provide 250 grams of bathing soap per person per month.',
    },
    calc: {
      op: 'multiply',
      factor: 250,
      inputLabel: 'people',
      inputUnit: 'people',
      outputLabel: 'soap per month',
      outputUnit: 'grams',
      rounding: 'ceil',
    },
  }),
  r({
    id: 'R008',
    title: 'Covered living space per person',
    when: 'Planning shelters or tents for families',
    then: 'Provide at least 3.5 square metres of covered living space per person.',
    exceptions: [],
    severity: 'major',
    keywords: ['shelter', 'tent', 'living space', 'square metres', 'floor area', 'how big'],
    source: {
      section: 'Shelter',
      page: 4,
      quote: 'Provide at least 3.5 square metres of covered living space per person.',
    },
    calc: {
      op: 'multiply',
      factor: 3.5,
      inputLabel: 'people',
      inputUnit: 'people',
      outputLabel: 'covered space',
      outputUnit: 'square metres',
      rounding: 'round',
    },
  }),
];

export const FIELD_CARTRIDGE: Cartridge = {
  id: 'ctg-field',
  name: 'Field standards (test fixture)',
  version: 1,
  createdAt: '2026-11-16T00:00:00.000Z',
  sourceHash: 'test-fixture',
  rules: [...FIELD_RULES],
  changelog: ['Test fixture.'],
};
