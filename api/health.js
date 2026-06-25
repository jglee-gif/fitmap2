const { loadMentors } = require('../lib/mentors');

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const mentors = loadMentors();
    res.status(200).json({ status: 'ok', mentors: mentors.length, version: '2.0.0' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};
