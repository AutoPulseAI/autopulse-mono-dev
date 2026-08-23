<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Invoice</title>
    <style>
        body {
            font-family: Arial, sans-serif;
        }
        .invoice-box {
            max-width: 800px;
            margin: auto;
            padding: 15px;
            border: 1px solid #eee;
            font-size: 16px;
            line-height: 24px;
            color: #0F141E;
        }
        .invoice-box table {
            width: 100%;
            line-height: inherit;
            text-align: left;
        }
        .invoice-box table td {
            padding: 5px;
            vertical-align: top;
        }
        .invoice-box table tr td:nth-child(2), .total td {
            text-align: right;
        }
        .invoice-box table tr.top table td {
            padding-bottom: 20px;
        }
        .invoice-box table tr.information table td {
            padding-bottom: 40px;
        }
        .invoice-box table tr.heading td {
            background: #eee;
            border-bottom: 1px solid #ddd;
            font-weight: bold;
        }
        .invoice-box table tr.details td {
            padding-bottom: 20px;
        }
        .invoice-box table tr.item td {
            border-bottom: 1px solid #eee;
        }
        .invoice-box table tr.item.last td {
            border-bottom: none;
        }
        .invoice-box table tr.total td {
            border-top: 2px solid #eee;
            font-weight: bold;
        }
    </style>
</head>
<body>
    <div class="invoice-box">
        <table>
            <tr class="top">
                <td colspan="2">
                    <table>
                        <tr>
                            <td class="title">
                            <img src="{{asset('assets/images/logo-b.png') }}" alt="Image" width="160">
                            </td>
                            <td>
                                Invoice #: {{ now()->timestamp }}<br>
                                Created: {{ now()->toFormattedDateString() }}<br>
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>

            <tr class="information">
                <td colspan="2">
                    <table>
                        <tr>
                            <td>
                                Dealer: {{ $dealer->dealership_group }}<br>
                                Email: {{ $dealer->email }}
                            </td>
                            <td>
                                {{ env('APP_NAME') }}<br>
                                {{ env('APP_URL') }}
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>

            <tr class="heading">
                <td>Dealership Name</td>
                <td>Final Price</td>
            </tr>

            @foreach ($purchasedStores as $store)
            <tr class="item">
                <td>
                    {{ $store['dealership_name'] }}<br>
                    Subscription Price: ${{ number_format($store['subscription_price'], 2) }}<br>
                    Coupon Code: {{ $store['coupon_code'] ?? 'N/A' }}<br>
                    Discount: -${{ number_format($store['discount_amount'], 2) }}
                </td>
                <td>${{ number_format($store['final_price'], 2) }}</td>
            </tr>
            @endforeach

            <tr class="total">
                <td colspan="2">Total: ${{ number_format($totalAmount, 2) }}</td>
            </tr>
            
        </table>
    </div>
</body>
</html>
