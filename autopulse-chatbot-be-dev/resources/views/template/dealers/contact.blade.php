<!-- resources/views/child.blade.php -->
 
@extends('layouts.front')
@section('title', 'Contact Autopulse AI | Customizable AI Solutions for Automotive Dealerships')

@section('meta_description', ' Meta Description: Contact Autopulse AI today to learn how our AI-powered chatbot, real-time live inventory, and customizable solutions can elevate your automotive dealership’s digital experience. Start your journey with us in just minutes.')
@section('content')
        <!-- Start Header  -->
        @include('template.dealers.include.header')
        <!-- End Header  -->

        <!-- start mobilemenu -->
        @include('template.dealers.include.mobilemenu')
        <!-- End mobilemenu -->

        <!-- Start Contact Area  -->
        <div class="main-content">

            <div class="rainbow-contact-area rainbow-section-gap head_height">
                <div class="container">
                    <div class="row">
                        <div class="col-lg-12 mb--40">
                            <div class="section-title text-center" data-sal="slide-up" data-sal-duration="700" data-sal-delay="100">
                                <h4 class="subtitle "><span class="theme-gradient">Contact Form</span></h4>
                                <h2 class="title w-600 mb--20">Our Contact Address Here.</h2>
                            </div>
                        </div>
                    </div>
                    <div class="row row--15">
                        <div class="col-lg-12">
                            <div class="rainbow-contact-address mt_dec--30">
                                <div class="row justify-content-center">
                                    <div class="col-xl-5 col-lg-6 col-md-6 col-12">
                                        <div class="service service__style--1">
                                            <div class="service_shape_box">
                                                <div class="rainbow-address position-relative">
                                                    <div class="icon justify-content-start">
                                                        <i class="feather-headphones"></i>
                                                    </div>
                                                    <div class="inner">
                                                        <h4 class="title">Contact Phone Number</h4>
                                                        <p class="mb-0"><a href="tel:9522128257">+1 000 000 0000</a></p>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="col-xl-5 col-lg-6 col-md-6 col-12">
                                        <div class="service service__style--1">
                                            <div class="service_shape_box">
                                                <div class="rainbow-address position-relative">
                                                    <div class="icon justify-content-start">
                                                        <i class="feather-mail"></i>
                                                    </div>
                                                    <div class="inner">
                                                        <h4 class="title">Our Email Address</h4>
                                                        <p><a href="mailto:">test@test.com</a></p>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                   
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="row justify-content-center mt--40 row--15">
                        <div class="col-lg-7">
                            <form action="" class="contact-form-1 rainbow-dynamic-form" id="contactus">
                                @csrf
                                <div class="form-group">
                                    <input type="text" name ="name" id ="name" class=" required" placeholder="Enter Full Name">
                                </div>
                                <div class="form-group">
                                    <input type="text" name ="email" id ="email"  class=" required email" placeholder="Enter Email Id">
                                </div>
                                <div class="form-group">
                                    <input type="text" name ="phone" id ="phone"  class=" required " placeholder="Enter Phone number">
                                </div>
                                
                                <div class="form-group">
                                    <textarea class=" required"  id ="message"  name="message" rows="3"></textarea>
                                </div>

                                <div class="form-group text-center">
                                    <button id ="contactbtn" type="submit" class="rainbow-gradient-btn btn-large"><span>Submit Now</span></button>
                                </div> 
                            </form>
                           
                        </div>
                        
                    </div>
                </div>
            </div>

        </div>
        <!-- End Contact Area  -->

        <!-- Start Footer Area  -->
        @include('template.dealers.include.footer')
        <!-- End Footer Area  -->

        <!-- Start Copy Right Area  -->
        @include('template.dealers.include.copyRight')
        <!-- End Copy Right Area  -->
<div id="thank_you" class="modal rbt-modal-box fade" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content wrapper top-flashlight leftside light-xl modal-small text-center align-items-center">
            <p class="b1 text-center mb--0 successmsgdiv"></p>
            <div class="bottom-btn mt--20 w-100">
                <button data-bs-dismiss="modal" class="btn-default btn-border btn-small round" onclick="showhide('authscreen','loginscreen');">Ok</button>
            </div>
            <button class="close-button" data-bs-dismiss="modal">
                <i class="feather-x"></i>
            </button>
        </div>
    </div>
</div>
@endsection

@push ('after-scripts')
<script>
    // HEADER JS - Header Sticky after login
    jQuery('.rbt-dashboard-header').addClass('header-sticky');

// FORM JS - Header Sticky after login
$('#contactus').submit(function(e){
    e.preventDefault();

       if($('#contactus').valid())
       
       {   
      
        url = '{{ route("contactus.post") }}';
           var formData = $('#contactus').serialize();
           var originalText = $('#contactbtn').text();
   
               // Change the text of the button to indicate processing
           $('#contactbtn').text('Please wait...').prop('disabled', true);
   
           runajax(url, formData, 'post', '', 'json', function(output) {
               
               $('#contactbtn').text(originalText).prop('disabled', false);
               if (output.success) 
               {
                   $('.successmsgdiv').html('Thank you your query have been sumitted. Please Contact soon.')
                   $('#thank_you').modal('show');

                   $('#contactus')[0].reset();	
                   
               }else{
                   
                   for (var key in output.data){
                   
                       existvalue= $('#'+key).val();
                       jQuery.validator.addMethod(key+"error", function(value, element) {
                           return this.optional(element) || value !== existvalue;
                       }, jQuery.validator.format(output.data[key][0]));
                       $('#'+key).addClass(key+"error");
                       jQuery('#'+key).valid();
                   }
                       
               }
           }); 
       }
   })
</script>
@endpush