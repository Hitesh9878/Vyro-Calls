const mongoose = require('mongoose');

// A pending "please add me" request. When it is accepted both people get a Contact
// document and this request is deleted; when declined or cancelled it is just deleted.
const requestSchema = new mongoose.Schema(
  {
    from: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    to: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

requestSchema.index({ from: 1, to: 1 }, { unique: true });
requestSchema.index({ to: 1, createdAt: -1 });

module.exports = mongoose.model('ContactRequest', requestSchema);
