import mongoose from 'mongoose';

const ticketCategorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true
  },
  description: String,
  active: {
    type: Boolean,
    default: true
  }
});

const TicketCategory = mongoose.model('TicketCategory', ticketCategorySchema);
export default TicketCategory;