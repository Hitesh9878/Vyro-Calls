const mongoose = require('mongoose');

// One row per call attempt, written when the call is resolved.
//   completed – the callee answered (duration is answer → hang-up)
//   missed    – the callee never answered: caller hung up, ring timeout,
//               callee offline / busy / disconnected
//   declined  – the callee pressed "decline"
const callSchema = new mongoose.Schema(
  {
    caller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    callee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    callType: { type: String, enum: ['audio', 'video'], default: 'audio' },
    status: { type: String, enum: ['completed', 'missed', 'declined'], required: true },
    startedAt: { type: Date, required: true },
    answeredAt: { type: Date },
    endedAt: { type: Date, required: true },
    duration: { type: Number, default: 0 }, // seconds
    // Group calls are logged once per invitee (caller = whoever started the group call)
    isGroup: { type: Boolean, default: false },
  },
  { timestamps: true }
);

callSchema.index({ caller: 1, startedAt: -1 });
callSchema.index({ callee: 1, startedAt: -1 });

module.exports = mongoose.model('Call', callSchema);
