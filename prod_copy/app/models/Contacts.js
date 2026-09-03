import mongoose from 'mongoose';

const contactSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: [true, 'First name is required'],
    trim: true,
    maxlength: [50, 'First name cannot exceed 50 characters']
  },
  lastName: {
    type: String,
    required: [true, 'Last name is required'],
    trim: true,
    maxlength: [50, 'Last name cannot exceed 50 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    trim: true,
    lowercase: true,
    match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/, 'Please fill a valid email address']
  },
  phone: {
    type: String,
    trim: true,
    maxlength: [20, 'Phone number cannot exceed 20 characters'],
    validate: {
      validator: function(v) {
        if (!v) return true;
        return /^[+]?[(]?[0-9]{1,4}[)]?[-\s\.]?[0-9]{1,4}[-\s\.]?[0-9]{1,9}$/.test(v);
      },
      message: props => `${props.value} is not a valid phone number!`
    }
  },
  message: {
    type: String,
    required: [true, 'Message is required'],
    trim: true,
    maxlength: [2000, 'Message cannot exceed 2000 characters']
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['new', 'in-progress', 'resolved'],
    default: 'new'
  },
  ipAddress: {
    type: String,
    trim: true
  }
});

// Add text index for search functionality
contactSchema.index({
  firstName: 'text',
  lastName: 'text',
  email: 'text',
  message: 'text'
});

// Prevent duplicate submissions (same email + similar message within 24 hours)
contactSchema.pre('save', async function(next) {
  const similarSubmission = await this.constructor.findOne({
    email: this.email,
    createdAt: { $gt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    message: { $regex: new RegExp(this.message.substring(0, 20), 'i') }
  });
  
  if (similarSubmission) {
    throw new Error('Similar submission detected within the last 24 hours');
  }
  next();
});
export const Contacts = mongoose.models.Contacts || mongoose.model('Contacts', contactSchema);
