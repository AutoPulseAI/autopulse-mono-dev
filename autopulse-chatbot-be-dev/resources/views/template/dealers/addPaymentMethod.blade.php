@extends('layouts.dealer')
 
@section('content')
<!-- <style>.example.example5 {
  background-color: #9169d8;
}

.example.example5 * {
  font-family: Helvetica Neue, Helvetica, Arial, sans-serif;
  font-size: 16px;
  font-weight: 400;
}

#example5-paymentRequest {
  max-width: 500px;
  width: 100%;
  margin-bottom: 10px;
}

.example.example5 fieldset {
  border: 1px solid #b5a4ed;
  padding: 15px;
  border-radius: 6px;
}

.example.example5 fieldset legend {
  margin: 0 auto;
  padding: 0 10px;
  text-align: center;
  font-size: 14px;
  font-weight: 500;
  color: #cdd0f8;
  background-color: #9169d8;
}

.example.example5 fieldset legend + * {
  clear: both;
}

.example.example5 .card-only {
  display: block;
}
.example.example5 .payment-request-available {
  display: none;
}

.example.example5 .row {
  display: -ms-flexbox;
  display: flex;
  margin: 0 0 10px;
}

.example.example5 .field {
  position: relative;
  width: 100%;
}

.example.example5 .field + .field {
  margin-left: 10px;
}

.example.example5 label {
  width: 100%;
  color: #cdd0f8;
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.example.example5 .input {
  width: 100%;
  color: #fff;
  background: transparent;
  padding: 5px 0 6px 0;
  border-bottom: 1px solid #a988ec;
  transition: border-color 0.3s cubic-bezier(0.165, 0.84, 0.44, 1);
}

.example.example5 .input::-webkit-input-placeholder {
  color: #bfaef6;
}

.example.example5 .input::-moz-placeholder {
  color: #bfaef6;
}

.example.example5 .input:-ms-input-placeholder {
  color: #bfaef6;
}

.example.example5 .input.StripeElement--focus,
.example.example5 .input:focus {
  border-color: #fff;
}
.example.example5 .input.StripeElement--invalid {
  border-color: #ffc7ee;
}

.example.example5 input:-webkit-autofill,
.example.example5 select:-webkit-autofill {
  -webkit-text-fill-color: #fce883;
  transition: background-color 100000000s;
  -webkit-animation: 1ms void-animation-out;
}

.example.example5 .StripeElement--webkit-autofill {
  background: transparent !important;
}

.example.example5 input,
.example.example5 button,
.example.example5 select {
  -webkit-animation: 1ms void-animation-out;
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
  outline: none;
  border-style: none;
  border-radius: 0;
}

.example.example5 select.input,
.example.example5 select:-webkit-autofill {
  background-image: url('data:image/svg+xml;utf8,<svg width="10px" height="5px" viewBox="0 0 10 5" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><path fill="#fff" d="M5.35355339,4.64644661 L9.14644661,0.853553391 L9.14644661,0.853553391 C9.34170876,0.658291245 9.34170876,0.341708755 9.14644661,0.146446609 C9.05267842,0.0526784202 8.92550146,-2.43597394e-17 8.79289322,0 L1.20710678,0 L1.20710678,0 C0.930964406,5.07265313e-17 0.707106781,0.223857625 0.707106781,0.5 C0.707106781,0.632608245 0.759785201,0.759785201 0.853553391,0.853553391 L4.64644661,4.64644661 L4.64644661,4.64644661 C4.84170876,4.84170876 5.15829124,4.84170876 5.35355339,4.64644661 Z" id="shape"></path></svg>');
  background-position: 100%;
  background-size: 10px 5px;
  background-repeat: no-repeat;
  overflow: hidden;
  text-overflow: ellipsis;
  padding-right: 20px;
}

.example.example5 button {
  display: block;
  width: 100%;
  height: 40px;
  margin: 20px 0 0;
  background-color: #fff;
  border-radius: 6px;
  color: #9169d8;
  font-weight: 500;
  cursor: pointer;
}

.example.example5 button:active {
  background-color: #cdd0f8;
}

.example.example5 .error svg .base {
  fill: #fff;
}

.example.example5 .error svg .glyph {
  fill: #9169d8;
}

.example.example5 .error .message {
  color: #fff;
}

.example.example5 .success .icon .border {
  stroke: #bfaef6;
}

.example.example5 .success .icon .checkmark {
  stroke: #fff;
}

.example.example5 .success .title {
  color: #fff;
}

.example.example5 .success .message {
  color: #cdd0f8;
}

.example.example5 .success .reset path {
  fill: #fff;
}</style> -->
<section class="account_main" id="subpage_mt">
    <div class="container">
        <div class="row">
            <div class="col col-lg-3 col-12">
                @include('template.dealers.include.sidebar')
               
            </div>
            <div class="col col-lg-9 col-12">
                <!-- Vehicles Of Interest -->
                @php
                    $user = Auth::guard('dealer')->user();  // Get the authenticated user
                @endphp
                <div class="acc_right_main">
                    <div class="acc_page_head sticky" id="acc_page_head">
                        <div class="row align-items-center justify-content-center">
                            <div class="col col-12">
                                <div class="position-relative d-flex align-items-center">
                                    <!-- Menu for Mobile -->
                                    <div class="position-relative listing_filter_icon">
                                        <a class="navbar-toggler navbarSideCollapse"><i class="fa-solid fa-bars"></i></a>
                                    </div>

                                    <!-- Heading -->
                                    <div class="acc_page_heading">
                                        <h3>Payment Information</h3>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="position-relative acc_page_content acc_page_box mt-3">
                      <div class="row justify-content-center">
                        <div class="col col-lg-10 col-12">
                          <div class="cell example example5 bg_yellow p-3 rounded" id="example-5">
                              <form id="planForm" action="{{route('dealer.update.card') }}" method="post">
                              @csrf
                              <input type="hidden" id="token" name="token" >
                              
                                  <div id="example5-paymentRequest">
                                      <!--Stripe paymentRequestButton Element inserted here-->
                                  </div>
                                  <fieldset>
                                      <div class="row">
                                        <div class="col col-12">
                                            <label for="example5-name" data-tid="elements_examples.form.name_label" class="mb-2">Name</label>
                                            <input id="example5-name" data-tid="elements_examples.form.name_placeholder" class="form-control" type="text" value="{{ auth('dealer')->user()->name }}" required="" autocomplete="name">
                                        </div>
                                      </div>
                                      <div class="row">
                                        <div class="col col-md-6 col-12">
                                            <label for="example5-email" data-tid="elements_examples.form.email_label" class="mb-2">Email</label>
                                            <input id="example5-email" data-tid="elements_examples.form.email_placeholder" class="form-control"  value="{{ auth('dealer')->user()->email }}" type="text" placeholder="janedoe@gmail.com" required="" autocomplete="email">
                                        </div>
                                        <div class="col col-md-6 col-12">
                                            <label for="example5-phone" data-tid="elements_examples.form.phone_label" class="mb-2">Phone</label>
                                            <input id="example5-phone" data-tid="elements_examples.form.phone_placeholder" class="form-control"  value="{{ auth('dealer')->user()->phone_number }}" type="text" placeholder="(941) 555-0123" required="" autocomplete="tel">
                                        </div>
                                      </div>
                                      <div data-locale-reversible>
                                      <div class="row">
                                          <div class="col col-12">
                                            <label for="example5-address" data-tid="elements_examples.form.address_label" class="mb-2">Address</label>
                                            <input id="example5-address" data-tid="elements_examples.form.address_placeholder" class="form-control" type="text" value="{{ auth('dealer')->user()->address }}" placeholder="185 Berry St" required="" autocomplete="address-line1">
                                          </div>
                                      </div>
                                      <div class="row" data-locale-reversible>
                                          <div class="col col-md-4 col-12">
                                            <label for="example5-city" data-tid="elements_examples.form.city_label" class="mb-2">City</label>
                                            <input id="example5-city" data-tid="elements_examples.form.city_placeholder" class="form-control" type="text"  value="{{ auth('dealer')->user()->state }}" placeholder="San Francisco" required="" autocomplete="address-level2">
                                          </div>
                                          <div class="col col-md-4 col-12">
                                            <label for="example5-state" data-tid="elements_examples.form.state_label" class="mb-2">State</label>
                                            <input id="example5-state" data-tid="elements_examples.form.state_placeholder" class="form-control empty"  value="{{ auth('dealer')->user()->city }}" type="text" placeholder="CA" required="" autocomplete="address-level1">
                                          </div>
                                          <div class="col col-md-4 col-12">
                                            <label for="example5-zip" data-tid="elements_examples.form.postal_code_label" class="mb-2">ZIP</label>
                                            <input id="example5-zip" data-tid="elements_examples.form.postal_code_placeholder" class="form-control empty"  value="{{ auth('dealer')->user()->zip_code }}" type="text" placeholder="94107" required="" autocomplete="postal-code">
                                          </div>
                                      </div>
                                      </div>

                                      <div class="row">
                                          <div class="col col-12">
                                              <label for="example5-card" data-tid="elements_examples.form.card_label" class="mb-2">Card</label>
                                              <div id="example5-card" class="form-control"></div>
                                          </div>
                                      </div>

                                      <div class="row">
                                        <div class="col col-12">
                                          <div class="position-relative agree_text mt-2">
                                            <div class="form-check">
                                              <input class="form-check-input" type="checkbox" value="" id="flexCheckDefault">
                                              <label class="form-check-label text_secondary" for="flexCheckDefault">
                                              By continuing I agree with the <a href="{{ route('privacy') }}" target="blank">Privacy Policy</a>&nbsp;and&nbsp;<a href="{{ route('term') }}" target="blank">Terms & Conditions</a>
                                              </label>
                                            </div>                                           
                                          </div>
                                        </div>
                                      </div>

                                      <div id="card-errors" role="alert" class="py-2"></div>
                                      <div class="position-relative text-center">
                                      <button type="button" id="card-button" data-tid="elements_examples.form.pay_button" class="btn btn_theme">Add Card </button>
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
</section>
  <!-- Success Modal -->
<div class="modal fade" id="thank_you_msg" tabindex="-1" role="dialog" aria-labelledby="exampleModalLabel" aria-hidden="true">
  <div class="modal-dialog" role="document">
    <div class="modal-content">
        <div class="modal-header">
            <h5 class="modal-title" id="exampleModalLabel">Success</h5>
        
        </div>
        <div class="modal-body">
            Your Card Has been updated Successfully.
        </div>
        <div class="modal-footer">
            <a href="{{ route('dealer.payment_method')}}" class="btn btn-secondary" >OK</a>
        </div>
    </div>
  </div>
</div>


@endsection

@push ('after-scripts')
<script src="https://js.stripe.com/v3/"></script>
<script>
const stripe = Stripe("{{ env('STRIPE_KEY') }}"); // Use your actual public key
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
            console.log(result.paymentMethod.id);
            submitTokenToServer(result.paymentMethod.id);
            //submitTokenToServer(result.paymentMethod.id);
            // Optionally submit the form here or perform additional actions:
            // document.getElementById('planForm').submit();
        }
    });
});

function submitTokenToServer(token) {
    url = $('#planForm').attr('action');
    var formData = new FormData($('#planForm')[0]);

    uploadajax(url, formData, 'post', '', 'json', function(output) {
        if (output.success) {
               
                $('#thank_you_msg').modal('show');
            }else{
                $('#card-errors').text(output.message).show();
            }
    });
}

</script>
@endpush