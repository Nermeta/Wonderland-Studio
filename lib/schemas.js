/**
 * Per-collection field schemas, derived from the site architecture doc and
 * checked against the real files in the repo.
 *
 * Field types: text, combo (text + suggestions), longtext, date, number,
 * select (strict options), list (chips), bool, ref (pick another doc's slug),
 * badge (custom badge-art control). `hidden` fields are never shown; they are
 * only written when a new file is created.
 */
const f = (key, label, type, extra = {}) => ({ key, label, type, ...extra });

const TITLE = f('title', 'Title', 'text', { required: true, quote: true, wide: true });
const DATE = f('date', 'Date', 'date');
const TOPIC = f('topic', 'Topic', 'combo');
const TAGS = f('tags', 'Tags', 'list', { wide: true, hint: 'Enter or comma to add' });
const AUDIENCE = f('audience', 'Audience', 'list', { options: ['tech', 'general'], hint: 'Who this is for. Sent to the site’s AI chat (context.json) so it can match visitors to entries. Not shown on the page.' });
const SUMMARY = f('summary', 'Summary', 'longtext', { wide: true, hint: 'The italic subtitle under the title' });
const PUBLIC = f('public', 'Visible to the AI chat', 'bool', {
  default: true,
  hint: 'Off = left out of context.json. The page still publishes.'
});
const TYPE = t => f('type', 'Type', 'text', { hidden: true, default: t });

const COLLECTIONS = [
  {
    id: 'library', dir: '_book-reviews', config: 'book-reviews', label: 'Library', singular: 'review', glyph: '❦',
    kinds: {
      default: {
        label: 'Book review',
        fields: [
          TITLE, DATE, TYPE('book-review'), TOPIC,
          f('author', 'Author', 'text'),
          f('isbn', 'ISBN', 'text', { quote: true, pattern: '^[0-9Xx-]{10,17}$', hint: 'Used to fetch the cover' }),
          f('genre', 'Genre', 'list'),
          f('rating', 'Rating', 'number', { min: 1, max: 5, step: 1, integer: true }),
          f('finished_date', 'Finished', 'date'),
          f('pages', 'Pages', 'number', { min: 1, integer: true }),
          TAGS, AUDIENCE, SUMMARY, PUBLIC
        ]
      }
    }
  },
  {
    id: 'emblems', dir: '_certifications', config: 'certifications', label: 'Emblems', singular: 'emblem', glyph: '✦',
    detect: d => (d.category === 'education' ? 'education' : 'badge'),
    kinds: {
      badge: {
        label: 'Certification',
        fields: [
          TITLE, TOPIC,
          f('status', 'Status', 'select', { required: true, options: ['earned', 'in-progress'] }),
          DATE,
          f('shape', 'Shape', 'select', { required: true, options: ['round', 'shield', 'hex'], custom: true }),
          f('badge_image', 'Badge art', 'badge', { custom: true }),
          f('issuer', 'Issuer', 'text'),
          f('cert_url', 'Credential link', 'text', { hint: 'External URL' }),
          f('description', 'Description', 'longtext', { wide: true }),
          f('skills', 'Skills', 'list', { wide: true }),
          PUBLIC
        ]
      },
      education: {
        label: 'Education',
        fixed: { category: 'education' },
        fields: [
          TITLE,
          f('category', 'Category', 'text', { hidden: true, default: 'education' }),
          f('institution', 'Institution', 'text'),
          f('location', 'Location', 'text'),
          f('date_start', 'Started', 'date'),
          f('date_end', 'Ended', 'date'),
          f('graduated', 'Graduated', 'bool', { default: false }),
          f('grad_label', 'Graduation label', 'text', { quote: true }),
          f('years', 'Years', 'text', { quote: true }),
          f('status', 'Status', 'select', { required: true, options: ['earned', 'in-progress'] }),
          f('note', 'Note', 'text', { wide: true }),
          PUBLIC
        ]
      }
    }
  },
  {
    id: 'discoveries', dir: '_deep-dives', config: 'deep-dives', label: 'Discoveries', singular: 'deep dive', glyph: '◈',
    kinds: {
      default: {
        label: 'Deep dive',
        fields: [
          TITLE, DATE, TYPE('deep-dive'), TOPIC, TAGS,
          f('difficulty', 'Difficulty', 'combo', { options: ['beginner', 'intermediate', 'advanced'] }),
          f('tech_stack', 'Subjects', 'list', { hint: 'Shown as “Subjects” in the margin' }),
          f('estimated_read', 'Minutes to read', 'number', { min: 1, integer: true }),
          AUDIENCE, SUMMARY, PUBLIC
        ]
      }
    }
  },
  {
    id: 'chronicles', dir: '_learning-logs', config: 'learning-logs', label: 'Chronicles', singular: 'chronicle', glyph: '☾',
    detect: d => (d.parent ? 'session' : 'skill'),
    kinds: {
      skill: {
        label: 'Skill',
        fields: [
          TITLE, DATE, TYPE('learning-log'), TOPIC,
          f('subject', 'Subject', 'text'),
          f('domain', 'Domain', 'combo'),
          f('status', 'Status', 'select', { options: ['not-started', 'in-progress', 'completed'] }),
          f('requires', 'Requires', 'list', { suggest: 'skills', wide: true, hint: 'Slugs of skills to learn first' }),
          TAGS, AUDIENCE, SUMMARY, PUBLIC
        ]
      },
      session: {
        label: 'Session log',
        fields: [
          TITLE, DATE, TYPE('learning-log'),
          f('parent', 'Parent skill', 'ref', { required: true, ref: 'skills' }),
          f('domain', 'Domain', 'combo'),
          f('status', 'Status', 'select', { options: ['not-started', 'in-progress', 'completed'] }),
          f('requires', 'Requires', 'list', { suggest: 'skills', wide: true }),
          TAGS, AUDIENCE, SUMMARY, PUBLIC
        ]
      }
    }
  },
  {
    id: 'explorations', dir: '_tutorials', config: 'tutorials', label: 'Explorations', singular: 'tutorial', glyph: '✧', datePrefix: true,
    kinds: {
      default: {
        label: 'Tutorial',
        fields: [
          TITLE, DATE, TYPE('tutorial'), TOPIC, TAGS,
          f('difficulty', 'Difficulty', 'combo', { options: ['apprentice', 'journeyman', 'expert'] }),
          f('tech_stack', 'Tech stack', 'list', { hint: 'Rendered as teal tags' }),
          f('estimated_read', 'Minutes to read', 'number', { min: 1, integer: true }),
          AUDIENCE, SUMMARY, PUBLIC
        ]
      }
    }
  },
  {
    id: 'field-notes', dir: '_writeups', config: 'writeups', label: 'Field Notes', singular: 'writeup', glyph: '⚑', datePrefix: true,
    kinds: {
      default: {
        label: 'Writeup',
        fields: [
          TITLE, DATE, TYPE('writeup'), TOPIC,
          f('platform', 'Platform', 'combo', { options: ['HackTheBox', 'TryHackMe', 'CTF'], hint: 'Groups the index page' }),
          f('category', 'Category', 'combo'),
          f('difficulty', 'Difficulty', 'combo', { options: ['easy', 'medium', 'hard', 'insane'] }),
          f('tools', 'Tools', 'list', { wide: true }),
          f('outcome', 'Outcome', 'combo', { options: ['completed', 'partial'] }),
          TAGS, AUDIENCE, SUMMARY, PUBLIC
        ]
      }
    }
  }
];

for (const c of COLLECTIONS) {
  for (const [name, k] of Object.entries(c.kinds)) {
    k.name = name;
    k.order = k.fields.map(x => x.key);
  }
}

module.exports = { COLLECTIONS };
