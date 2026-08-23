@extends('layouts.dealer')

@section('content')
<section class="account_main" id="subpage_mt">
    <div class="container">
        <div class="row">
            <div class="col col-lg-3 col-12">
                @include('template.dealers.include.sidebar')
            </div>
            <div class="col col-lg-9 col-12">
                <div class="acc_right_main">
                    <div class="acc_page_head sticky" id="acc_page_head">
                        <div class="row align-items-center justify-content-center">
                            <div class="col col-lg-10 col-12">
                                <div class="position-relative d-flex align-items-center">
                                    <div class="position-relative listing_filter_icon">
                                        <a class="navbar-toggler navbarSideCollapse"><i class="fa-solid fa-bars"></i></a>
                                    </div>
                                    <div class="acc_page_heading">
                                        <h3>Payment Information</h3>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="position-relative mt-3">
                        <div class="row justify-content-center">
                            <div class="col col-lg-10 col-12">
                                <div class="cell example example5" id="example-5">
                                    @if($paymentMethod)
                                        <div class="acc_page_content acc_page_box border-bottom pb-4">
                                            <div class="default-payment-method">
                                                <h4>Default Payment Method</h4>
                                                <p>Card ending in {{ $paymentMethod->card->last4 }}</p>
                                                <div class="row position-relative agree_text text-center mb-3">
                                                    <div class="col col-12">
                                                        <p class="form-check mb-0 text_secondary text-start">
                                                            <input type="checkbox" class="form-check-input required" onclick="iagree(this, '#default-card-button')" name="i_agree_default" value="1" id="i_agreee_default">
                                                            <label class="form-check-label" for="i_agreee_default"><small class="ms-2">By continuing I agree with the <a href="{{ route('privacy') }}" target="_blank">Privacy Policy</a>, <a href="{{ route('term') }}" target="_blank">Terms & Conditions</a></small></label>
                                                        </p>
                                                    </div>
                                                </div>
                                                <div class="position-relative text-center">
                                                    <button type="button" id="default-card-button" class="btn paymentbtn btn_theme" disabled>Pay ${{ $cartData['totalAmount'] }}</button>
                                                </div>
                                            </div>
                                        </div>

                                        <div class="my-3 text-center">OR</div>
                                    @endif
                                    <div id="example6-paymentRequest" style="display:none;">
                                        <!--Stripe paymentRequestButton Element inserted here-->
                                        <div class="my-3 text-center">OR</div>
                                    </div>
                                    

                                    <div class="cell example example5 bg_yellow p-3 rounded">
                                        <form id="planForm" action="{{ route('dealer.store.processPayment') }}" method="post">
                                            @csrf
                                            <input type="hidden" id="plan_id" name="plan_id" value="{{ $cartData['plan_id'] }}">
                                            <fieldset>
                                                <div class="row">
                                                    <div class="col col-12">
                                                        <label for="example5-name" class="mb-2">Name</label>
                                                        <input id="example5-name" class="form-control" type="text" value="{{ auth('dealer')->user()->name }}" required autocomplete="name">
                                                    </div>
                                                </div>
                                                <div class="row">
                                                    <div class="col col-md-6 col-12">
                                                        <label for="example5-email" class="mb-2">Email</label>
                                                        <input id="example5-email" class="form-control" value="{{ auth('dealer')->user()->email }}" type="text" required autocomplete="email">
                                                    </div>
                                                    <div class="col col-md-6 col-12">
                                                        <label for="example5-phone" class="mb-2">Phone</label>
                                                        <input id="example5-phone" class="form-control" value="{{ auth('dealer')->user()->phone_number }}" type="text" required autocomplete="tel">
                                                    </div>
                                                </div>
                                                <div class="row">
                                                    <div class="col col-12">
                                                        <label for="example5-address" class="mb-2">Address</label>
                                                        <input id="example5-address" class="form-control" type="text" value="{{ auth('dealer')->user()->address }}" required autocomplete="address-line1">
                                                    </div>
                                                </div>
                                                <div class="row">
                                                    <div class="col col-md-4 col-12">
                                                        <label for="example5-city" class="mb-2">City</label>
                                                        <input id="example5-city" class="form-control" type="text" value="{{ auth('dealer')->user()->city }}" required autocomplete="address-level2">
                                                    </div>
                                                    <div class="col col-md-4 col-12">
                                                        <label for="example5-state" class="mb-2">State</label>
                                                        <input id="example5-state" class="form-control" type="text" value="{{ auth('dealer')->user()->state }}" required autocomplete="address-level1">
                                                    </div>
                                                    <div class="col col-md-4 col-12">
                                                        <label for="example5-zip" class="mb-2">ZIP</label>
                                                        <input id="example5-zip" class="form-control" type="text" value="{{ auth('dealer')->user()->zip_code }}" required autocomplete="postal-code">
                                                    </div>
                                                </div>
                                                <div class="row">
                                                    <div class="col col-12">
                                                        <input type="hidden" id="token" name="token">
                                                        <label for="example5-card" class="mb-2">Card</label>
                                                        <div id="example5-card" class="form-control"></div>
                                                    </div>
                                                </div>
                                                <div id="card-errors" role="alert" class="py-2"></div>
                                                <div class="row position-relative agree_text text-center mb-3">
                                                    <div class="col col-12">
                                                        <p class="form-check mb-0 text_secondary text-start">
                                                            <input type="checkbox" class="form-check-input required" onclick="iagree(this, '#card-button')" name="i_agree" value="1" id="i_agreee">
                                                            <label class="form-check-label" for="i_agreee"><small class="ms-2">By continuing I agree with the <a href="{{ route('privacy') }}" target="_blank">Privacy Policy</a>, <a href="{{ route('term') }}" target="_blank">Terms & Conditions</a></small></label>
                                                        </p>
                                                    </div>
                                                </div>
                                                <div class="position-relative text-center">
                                                    <button type="button" id="card-button" class="btn paymentbtn btn_theme" disabled>Pay ${{ $cartData['totalAmount'] }}</button>
                                                </div>
                                            </fieldset>
                                        </form>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</section>

<!-- Success Modal -->
<div class="modal fade" id="thank_you_msg" tabindex="-1" role="dialog" aria-labelledby="exampleModalLabel" aria-hidden="true">
    <div class="modal-dialog" role="document">
        <div class="modal-content">
            <div class="modal-header">
                <h5 class="modal-title text-success" id="exampleModalLabel">Success</h5>
            </div>
            <div class="modal-body">
                Your subscription has been processed successfully. Click Ok to move to the Home page.
            </div>
            <div class="modal-footer">
                <a href="{{ route('dealer.stores') }}" class="btn btn-secondary">OK</a>
            </div>
        </div>
    </div>
</div>

<div class="modal fade" id="proceednext" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered modal-sm">
        <div class="modal-content">
            <div class="modal-body">
                <div class="position-relative logout_confirmation_modal">
                    <button type="button" class="btn-close modal_close_btn" data-bs-dismiss="modal" aria-label="Close"></button>
                    <div class="row">
                        <div class="col col-12">
                            <div class="position-relative">
                                <div class="modal_heading">
                                    <h3>Confirm</h3>
                                </div>
                                <div class="position-relative logout_icon_text mt-4">
                                    <p id="confirm_msg_alert">Are you sure you want to proceed with this plan?</p>
                                </div>
                                <div class="position-relative text-center mb-3">
                                    <a onclick="submitTokenToServer(3)" href="javascript:;" class="btn btn_theme_light">Confirm</a>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>
@endsection

@push ('after-scripts')
<script src="https://js.stripe.com/v3/"></script>
<script>
function iagree(obj, buttonId) {
    var agreeCheckbox = $(obj);
    var cardButton = $(buttonId);
    cardButton.prop('disabled', !agreeCheckbox.is(':checked'));
}

const stripe = Stripe("{{ env('STRIPE_KEY') }}");
var elements = stripe.elements();
var card = elements.create("card", {
    style: {
        base: {
            iconColor: "#6c757d",
            color: "#2F3B48",
            fontWeight: 400,
            fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif",
            fontSize: "16px",
            fontSmoothing: "antialiased",
            "::placeholder": {
                color: "#6c757d"
            },
            ":-webkit-autofill": {
                color: "#fce883"
            }
        },
        invalid: {
            iconColor: "#ff0000",
            color: "#ff0000"
        }
    }
});
card.mount("#example5-card");

// Payment Request Button
var paymentRequest = stripe.paymentRequest({
    country: 'US',
    currency: 'usd',
    total: {
        label: 'Total',
        amount: {{ $cartData['totalAmount'] * 100 }},
    },
    requestPayerName: true,
    requestPayerEmail: true,
    requestPayerPhone: true,
});

var prButton = elements.create('paymentRequestButton', {
    paymentRequest: paymentRequest,
});

paymentRequest.canMakePayment().then(function(result) {
    if (result) {
        document.getElementById('example5-paymentRequest').style.display = 'block';
        prButton.mount('#example5-paymentRequest');
    } else {
        document.getElementById('example5-paymentRequest').style.display = 'none';
    }
});

paymentRequest.on('paymentmethod', function(ev) {
    var form = document.getElementById('planForm');
    var formData = new FormData(form);
    formData.append('payment_method_id', ev.paymentMethod.id);

    fetch(form.action, {
        method: 'POST',
        body: formData,
    }).then(function(response) {
        return response.json();
    }).then(function(result) {
        if (result.error) {
            ev.complete('fail');
            document.getElementById('card-errors').textContent = result.error;
        } else {
            ev.complete('success');
            document.getElementById('thank_you_msg').modal('show');
        }
    });
});
@if($paymentMethod)
document.getElementById('default-card-button').addEventListener('click', function (event) {
    event.preventDefault();
    document.getElementById('token').value = '{{ $paymentMethod->id }}';
    makepayment();
});
@endif

document.getElementById('card-button').addEventListener('click', function (event) {
    event.preventDefault();
    stripe.createPaymentMethod({
        type: 'card',
        card: card,
        billing_details: {
            name: document.getElementById('example5-name').value,
            email: document.getElementById('example5-email').value,
            phone: document.getElementById('example5-phone').value,
            address: {
                line1: document.getElementById('example5-address').value,
                city: document.getElementById('example5-city').value,
                state: document.getElementById('example5-state').value,
                postal_code: document.getElementById('example5-zip').value,
            }
        }
    }).then(function(result) {
        if (result.error) {
            document.getElementById('card-errors').textContent = result.error.message;
            document.getElementById('card-errors').style.display = 'block';
        } else {
            document.getElementById('token').value = result.paymentMethod.id;
            makepayment();
        }
    });
});

function makepayment() {
    var formData = new FormData($('#planForm')[0]);
    url = $('#planForm').attr('action');
    uploadajax(url, formData, 'post', '', 'json', function(output) {
      
        if (output.success) {
                $('.modal').modal('hide');
                $('#thank_you_msg').modal('show');
            }else{
                $('#card-errors').text(output.message).show();
            }
            $('#card-button').text(text);
    });
   
}
</script>
@endpush
