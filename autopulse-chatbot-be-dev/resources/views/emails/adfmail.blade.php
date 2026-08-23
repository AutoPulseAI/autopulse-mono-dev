{!! '<'.'?xml version="1.0" encoding="UTF-8"?>' !!}{!! '<'.'?adf version="1.0"?>' !!}
<adf>
    <prospect>
        <requestdate>{{ $vehicle['last_seen_at_date'] ?? 'null' }}</requestdate>
        <status>new</status>
        <vehicle>
            <id>{{ $vehicle['id'] ?? 'null' }}</id>
            <vin>{{ $vehicle['vin'] ?? 'null' }}</vin>
            <year>{{ $vehicle['build']['year'] ?? 'null' }}</year>
            <make>{{ $vehicle['build']['make'] ?? 'null' }}</make>
            <model>{{ $vehicle['build']['model'] ?? 'null' }}</model>
            <trim>{{ $vehicle['build']['trim'] ?? 'null' }}</trim>
            <bodytype>{{ $vehicle['build']['body_type'] ?? 'null' }}</bodytype>
            <vehicletype>{{ $vehicle['build']['vehicle_type'] ?? 'null' }}</vehicletype>
            <price>
                <base>{{ $vehicle['price'] ?? 'null' }}</base>
                <msrp>{{ $vehicle['msrp'] ?? 'null' }}</msrp>
                <price_change_percent>{{ $vehicle['price_change_percent'] ?? 'null' }}</price_change_percent>
            </price>
            <odometers>
                <odometer>
                    <status>actual</status>
                    <value>{{ $vehicle['miles'] ?? 'null' }}</value>
                </odometer>
            </odometers>
            <exteriorcolor>{{ $vehicle['exterior_color'] ?? 'null' }}</exteriorcolor>
            <interiorcolor>{{ $vehicle['interior_color'] ?? 'null' }}</interiorcolor>
            <doors>{{ $vehicle['build']['doors'] ?? 'null' }}</doors>
            <transmission>{{ $vehicle['build']['transmission'] ?? 'null' }}</transmission>
            <fueltype>{{ $vehicle['build']['fuel_type'] ?? 'null' }}</fueltype>
            <drivetrain>{{ $vehicle['build']['drivetrain'] ?? 'null' }}</drivetrain>
            <highwaympg>{{ $vehicle['build']['highway_mpg'] ?? 'null' }}</highwaympg>
            <citympg>{{ $vehicle['build']['city_mpg'] ?? 'null' }}</citympg>
            <powertraintype>{{ $vehicle['build']['powertrain_type'] ?? 'null' }}</powertraintype>
            <media>
                @if(isset($vehicle['media']['photo_links']))
                    @foreach ($vehicle['media']['photo_links'] as $photo)
                        <photourl>{{ $photo }}</photourl>
                    @endforeach
                @else
                    <photourl>null</photourl>
                @endif
            </media>
            <options>
                @if(isset($vehicle['extra']['options']))
                    @foreach ($vehicle['extra']['options'] as $option)
                        <option>{{ $option }}</option>
                    @endforeach
                @else
                    <option>null</option>
                @endif
            </options>
            <source>autopulse</source>
        </vehicle>
        <customer>
            <contact>
                <name part="full">{{ $user['name'] ?? 'null' }}</name>
                <email>{{ $user['email'] ?? 'null' }}</email>
                <phone>
                    <number>{{ $user['phone_number'] ?? 'null' }}</number>
                </phone>
                <address>
                    <street>{{ $user['address'] ?? 'null' }}</street>
                    <city>{{ $user['city'] ?? 'null' }}</city>
                    <regioncode>{{ $user['state']?? 'null' }}</regioncode>
                    <postalcode>{{$user['zip_code'] ?? 'null' }}</postalcode>
                    <country>US</country>
                </address>
                @if(!empty($booking))
                <timeframe>
                    <description>Appointment requested on {{ $booking['booking_date'] ?? '' }} at {{ $booking['booking_time'] ?? '' }}</description>
                </timeframe>
                @endif
                <source>autopulse</source>
            </contact>
            <source>autopulse</source>
        </customer>
        <vendor>
            <vendorname>{{ $vehicle['dealer']['name'] ?? 'null' }}</vendorname>
            <contact>
                <name part="full">{{ $vehicle['dealer']['name'] ?? 'null' }}</name>
                <email>{{ $vehicle['dealer']['seller_email'] ?? 'null' }}</email>
                <phone>
                    <number>{{ $vehicle['dealer']['phone'] ?? 'null' }}</number>
                </phone>
                <address>
                    <street>{{ $vehicle['dealer']['street'] ?? 'null' }}</street>
                    <city>{{ $vehicle['dealer']['city'] ?? 'null' }}</city>
                    <regioncode>{{ $vehicle['dealer']['state'] ?? 'null' }}</regioncode>
                    <postalcode>{{ $vehicle['dealer']['zip'] ?? 'null' }}</postalcode>
                    <country>US</country>
                </address>
            </contact>
            <source>autopulse</source>
        </vendor>
        @if(!empty($booking))
        <customercomments>Booking requested: Date {{ $booking['booking_date'] ?? '' }}, Time {{ $booking['booking_time'] ?? '' }}, Phone {{ $booking['phone'] ?? ($user['phone_number'] ?? '') }}</customercomments>
        @else
        <customercomments>{{ $vehicle['seller_comments'] ?? 'null' }}</customercomments>
        @endif
        <source>autopulse</source>
    </prospect>
</adf>
