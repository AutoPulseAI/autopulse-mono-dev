@extends('layouts.dealer')
 
@section('content')

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
                            <div class="col col-lg-10 col-12">
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
                    
                    <div class="position-relative mt-3">
                      <div class="row justify-content-center">
                        <div class="col col-lg-10 col-12">
                          <div class="cell example example5" id="example-5">
                              <form id="planForm" action="{{route('subscribe.process.ajax') }}" method="post">
                              @csrf
                             
                              <input type="hidden" value="{{ $plans->id }}" id="plan_id" name="plan_id" >
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
                                                    <input id="example5-city" data-tid="elements_examples.form.city_placeholder" class="form-control" type="text"  value="{{ auth('dealer')->user()->city }}" placeholder="San Francisco" required="" autocomplete="address-level2">
                                                </div>
                                                <div class="col col-md-4 col-12">
                                                    <label for="example5-state" data-tid="elements_examples.form.state_label" class="mb-2">State</label>
                                                    <input id="example5-state" data-tid="elements_examples.form.state_placeholder" class="form-control empty"  value="{{ auth('dealer')->user()->state }}" type="text" placeholder="CA" required="" autocomplete="address-level1">
                                                </div>
                                                <div class="col col-md-4 col-12">
                                                    <label for="example5-zip" data-tid="elements_examples.form.postal_code_label" class="mb-2">ZIP</label>
                                                    <input id="example5-zip" data-tid="elements_examples.form.postal_code_placeholder" class="form-control empty"  value="{{ auth('dealer')->user()->zip_code }}" type="text" placeholder="94107" required="" autocomplete="postal-code">
                                                </div>
                                            </div>
                                        </div>
                                      
                                      @if(isset($paymentMethod))
                                        <div class="row">
                                            <div class="col col-12">
                                            <input type="hidden" id="token" value="{{ $paymentMethod->id }}" name="token" >
                                                <label for="example5-card" data-tid="elements_examples.form.card_label" class="mb-2">Card</label>
                                                <input id="example5-city" data-tid="elements_examples.form.city_placeholder" class="form-control" type="text"  value="XXXX-XXXX-XXXX-{{ $paymentMethod->card->last4 }}" readonly>
                                            </div>
                                        </div>

                                        <div class="row position-relative agree_text text-center mt-3">
                                            <div class="col col-12"> 
                                                <p class="form-check mb-0 text_secondary text-start">
                                                    <input type="checkbox" class="form-check-input required" onclick="iagree(this)" name="i_agree" value="1" id="i_agreee">
                                                    <label class="form-check-label" for="i_agreee"><small class="ms-2">By continuing I agree with the <a href="{{ route('privacy') }}" target="blank">Privacy Policy</a>,&nbsp;<a href="{{ route('term') }}" target="blank">Terms & Conditions</a></small></label>
                                                </p>
                                            </div>
                                        </div>

                                        <div id="card-errors" role="alert" class="py-2"></div>
                                        <div class="position-relative text-center">
                                            <button type="button" id="" onclick="makepayment(0,1)" data-tid="elements_examples.form.pay_button" class="btn paymentbtn btn_theme" disabled>Pay ${{ $plans->price}} </button>
                                        </div>
                                      @else
                                        <div class="row">
                                            <div class="col col-12">
                                                <input type="hidden" id="token" name="token" >
                                                <label for="example5-card" data-tid="elements_examples.form.card_label" class="mb-2">Card</label>
                                                <div id="example5-card" class="form-control"></div>
                                            </div>
                                        </div>
                                        <div id="card-errors" role="alert" class="py-2"></div>
                                        <div class="row position-relative agree_text text-center mb-3">
                                            <div class="col col-12"> 
                                                <p class="form-check mb-0 text_secondary text-start">
                                                    <input type="checkbox" class="form-check-input required" onclick="iagree(this)" name="i_agree" value="1" id="i_agreee">
                                                    <label class="form-check-label" for="i_agreee"><small class="ms-2">By continuing I agree with the <a href="{{ route('privacy') }}" target="blank">Privacy Policy</a>,&nbsp;<a href="{{ route('term') }}" target="blank">Terms & Conditions</a></small></label>
                                                </p>
                                            </div>
                                        </div>
                                      <div class="position-relative text-center">
                                        <button type="button" id="card-button" data-tid="elements_examples.form.pay_button" class="btn paymentbtn btn_theme" disabled>Pay ${{ $plans->price}} </button>
                                      </div>
                                      @endif
                                      
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
        <h5 class="modal-title text-success" id="exampleModalLabel">Success</h5>
        <!--button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button-->
      </div>
      <div class="modal-body">
        Your subscription has been processed successfully. Click Ok to move to Home page
      </div>
      <div class="modal-footer">
        <a href="{{route('dealer.subscription')}}" class="btn btn-secondary" >OK</a>
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
                                    <p id="confirm_msg_alert">Are you sure you want to Procedd this plan</p>
                                    <p>Are you sure you want to Procedd this plan</p>
                                </div>        
                                
                                <div class="position-relative text-center mb-3">
                                    <a onclick="submitTokenToServer(3)" href="javascript:;" onclick="" class="btn btn_theme_light">Confirm</a>
                                    
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
function iagree(obj){

    var agreeCheckbox = $(obj);
    var cardButton = $(".paymentbtn");
  

    console.log("Checkbox changed");
    cardButton.prop('disabled', !agreeCheckbox.is(':checked'));

}
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
var cardElement = document.getElementById("example5-card");
if (cardElement) {
    card.mount("#example5-card");
}
var card_button = document.getElementById("card-button");
if (card_button) {
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
                makepayment(0,0);
                //submitTokenToServer(result.paymentMethod.id);
                // Optionally submit the form here or perform additional actions:
                // document.getElementById('planForm').submit();
            }
        });
    });
}
function makepayment(id,check=0)
{
   
    //text=   $('#card-button').text();
    //$('#card-button').text('Please Wait...');
   
    url = `{{ route('subscribe.checkPlan')}}`;
    var formData = new FormData($('#planForm')[0]);
    uploadajax(url, formData, 'post', '', 'json', function(output) {
        //$('#card-button').text(text);
        if (output.success) {
            submitTokenToServer(1)   
        }else{
            if(output.data.status ==0)
                    $('#card-errors').text(output.message).show();
            else{
                $('#confirm_msg_alert').text(output.message);
                $('#proceednext').modal('show');
            }
        } 
    });
}



function submitTokenToServer(token) {
    url = $('#planForm').attr('action');
    var formData = new FormData($('#planForm')[0]);
    text=   $('#card-button').text();
    $('#card-button').text('Please Wait...');
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


var agreeCheckbox = $("#i_agree");
var cardButton = $(".paymentbtn");


agreeCheckbox.on('change', function() {
    cardButton.prop('disabled', !agreeCheckbox.is(':checked'));
});

// Initial state
cardButton.prop('disabled', !agreeCheckbox.is(':checked'));

</script>
@endpush