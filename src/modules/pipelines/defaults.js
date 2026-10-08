const DEFAULT_PIPELINE_STAGES = [
  { name: 'Inquiry', position: 0, isDefault: true, isWon: false, isLost: false },
  { name: 'Qualified', position: 1, isDefault: false, isWon: false, isLost: false },
  { name: 'Proposal Sent', position: 2, isDefault: false, isWon: false, isLost: false },
  { name: 'Won', position: 3, isDefault: false, isWon: true, isLost: false },
  { name: 'Lost', position: 4, isDefault: false, isWon: false, isLost: true },
];

module.exports = { DEFAULT_PIPELINE_STAGES };
