# Store Hours & Contact Information - Usage Examples

## Database Migration

First, run the migration to add the new columns:

```bash
php artisan migrate
```

## Available Fields

### Store Address Information
- `store_address` - Street address
- `store_city` - City name
- `store_state` - State/Province
- `store_zip` - ZIP/Postal code
- `store_country` - Country (defaults to 'USA')

### Contact Person Information
- `contact_person_name` - Contact person's full name
- `contact_person_phone` - Phone number
- `contact_person_email` - Email address

### Store Hours Configuration
- `timezone` - Store timezone (defaults to 'America/New_York')
- `store_hours` - JSON field with daily hours
- `is_store_hours_enabled` - Enable/disable store hours checking
- `closed_message` - Message to show when store is closed

## Usage Examples

### 1. Creating/Updating Store Settings

```php
use App\Models\ChatSetting;

$chatSetting = ChatSetting::find(1);

$chatSetting->update([
    // Store Address
    'store_address' => '123 Main Street',
    'store_city' => 'New York',
    'store_state' => 'NY',
    'store_zip' => '10001',
    'store_country' => 'USA',
    
    // Contact Person
    'contact_person_name' => 'John Smith',
    'contact_person_phone' => '+1 (555) 123-4567',
    'contact_person_email' => 'john.smith@dealership.com',
    
    // Timezone
    'timezone' => 'America/New_York',
    
    // Store Hours
    'store_hours' => [
        'monday' => ['open' => '09:00', 'close' => '18:00', 'closed' => false],
        'tuesday' => ['open' => '09:00', 'close' => '18:00', 'closed' => false],
        'wednesday' => ['open' => '09:00', 'close' => '18:00', 'closed' => false],
        'thursday' => ['open' => '09:00', 'close' => '18:00', 'closed' => false],
        'friday' => ['open' => '09:00', 'close' => '18:00', 'closed' => false],
        'saturday' => ['open' => '10:00', 'close' => '16:00', 'closed' => false],
        'sunday' => ['open' => '12:00', 'close' => '16:00', 'closed' => true] // Closed on Sunday
    ],
    
    'is_store_hours_enabled' => true,
    'closed_message' => 'We are currently closed. Please leave a message and we will get back to you during business hours.'
]);
```

### 2. Using Helper Methods

```php
$chatSetting = ChatSetting::find(1);

// Check if store is currently open
if ($chatSetting->isStoreOpen()) {
    echo "Store is currently open!";
} else {
    echo "Store is currently closed.";
    
    // Get next opening time
    $nextOpening = $chatSetting->getNextOpeningTime();
    if ($nextOpening) {
        echo "Next opening: " . $nextOpening->format('l, M j \a\t g:i A');
    }
}

// Get formatted store hours for display
$formattedHours = $chatSetting->getFormattedStoreHours();
foreach ($formattedHours as $day => $hours) {
    echo "{$day}: {$hours}\n";
}

// Get full address
echo "Address: " . $chatSetting->full_address;
```

### 3. Default Store Hours Structure

```php
// Get default store hours template
$defaultHours = ChatSetting::getDefaultStoreHours();

// This returns:
[
    'monday' => ['open' => '09:00', 'close' => '18:00', 'closed' => false],
    'tuesday' => ['open' => '09:00', 'close' => '18:00', 'closed' => false],
    'wednesday' => ['open' => '09:00', 'close' => '18:00', 'closed' => false],
    'thursday' => ['open' => '09:00', 'close' => '18:00', 'closed' => false],
    'friday' => ['open' => '09:00', 'close' => '18:00', 'closed' => false],
    'saturday' => ['open' => '09:00', 'close' => '17:00', 'closed' => false],
    'sunday' => ['open' => '12:00', 'close' => '16:00', 'closed' => true]
]
```

### 4. In Controller (Example)

```php
use App\Models\ChatSetting;

class ChatController extends Controller
{
    public function checkStoreStatus($storeId)
    {
        $chatSetting = ChatSetting::where('store_id', $storeId)->first();
        
        if (!$chatSetting) {
            return response()->json(['error' => 'Store not found'], 404);
        }
        
        $isOpen = $chatSetting->isStoreOpen();
        $response = [
            'store_id' => $storeId,
            'is_open' => $isOpen,
            'store_name' => $chatSetting->dealership_name,
            'contact_person' => $chatSetting->contact_person_name,
            'phone' => $chatSetting->contact_person_phone,
            'address' => $chatSetting->full_address,
        ];
        
        if (!$isOpen) {
            $response['closed_message'] = $chatSetting->closed_message;
            $nextOpening = $chatSetting->getNextOpeningTime();
            if ($nextOpening) {
                $response['next_opening'] = $nextOpening->format('l, M j \a\t g:i A T');
            }
        }
        
        return response()->json($response);
    }
}
```

### 5. Common Timezone Examples

```php
// US Timezones
'America/New_York'     // Eastern Time
'America/Chicago'      // Central Time  
'America/Denver'       // Mountain Time
'America/Los_Angeles'  // Pacific Time

// Other Common Timezones
'America/Toronto'      // Canada Eastern
'Europe/London'        // UK
'Asia/Tokyo'          // Japan
```

### 6. Blade Template Usage

```blade
@if($chatSetting->is_store_hours_enabled)
    <div class="store-hours">
        <h4>Store Hours</h4>
        @foreach($chatSetting->getFormattedStoreHours() as $day => $hours)
            <div class="day-hours">
                <strong>{{ $day }}:</strong> {{ $hours }}
            </div>
        @endforeach
    </div>
    
    <div class="store-status">
        @if($chatSetting->isStoreOpen())
            <span class="open">🟢 Currently Open</span>
        @else
            <span class="closed">🔴 Currently Closed</span>
            @if($nextOpening = $chatSetting->getNextOpeningTime())
                <br><small>Opens {{ $nextOpening->format('l \a\t g:i A') }}</small>
            @endif
        @endif
    </div>
@endif

<div class="contact-info">
    <h4>Contact Information</h4>
    <p><strong>Contact:</strong> {{ $chatSetting->contact_person_name }}</p>
    <p><strong>Phone:</strong> {{ $chatSetting->contact_person_phone }}</p>
    <p><strong>Email:</strong> {{ $chatSetting->contact_person_email }}</p>
    <p><strong>Address:</strong> {{ $chatSetting->full_address }}</p>
</div>
```

## JSON Store Hours Format

The `store_hours` field uses this JSON structure:

```json
{
    "monday": {
        "open": "09:00",
        "close": "18:00", 
        "closed": false
    },
    "tuesday": {
        "open": "09:00",
        "close": "18:00",
        "closed": false
    },
    "wednesday": {
        "open": "09:00", 
        "close": "18:00",
        "closed": false
    },
    "thursday": {
        "open": "09:00",
        "close": "18:00", 
        "closed": false
    },
    "friday": {
        "open": "09:00",
        "close": "18:00",
        "closed": false
    },
    "saturday": {
        "open": "10:00",
        "close": "16:00",
        "closed": false
    },
    "sunday": {
        "open": "12:00",
        "close": "16:00",
        "closed": true
    }
}
```

## Notes

- Times are stored in 24-hour format (HH:MM)
- The `closed` field takes priority - if true, the store is considered closed regardless of open/close times
- All times are relative to the store's configured timezone
- The model automatically casts the `store_hours` JSON to an array
- Use the helper methods for timezone-aware operations
