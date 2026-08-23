<!-- Start Book a Demo Modal  -->
<div id="bookaDemoModal" class="modal rbt-modal-box fade" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content wrapper top-flashlight leftside light-xl">
            <h4 class="title">Book a Demo</h4>

            <!-- Start Form -->
            <form action="{{ route('dealer.requestDemo') }}" id="request_demo" class="rbt-image-genarator-row rbt-default-form row row--15">
                @csrf
                <div class="col-lg-6 col-md-6 col-sm-6 col-12">
                    <div class="form-group">
                        <label for="dealershipname">Dealership Name</label>
                       
                        <input id="dealership_name" name="dealership_name" type="text" class="required" placeholder="Dealership Name">
                    </div>
                </div>
                <div class="col-lg-6 col-md-6 col-sm-6 col-12">
                    <div class="form-group">
                        <label for="dealershipwebsite">Dealership Website</label>
                        <input id="website" name="website"  type="text" class="form-control required" placeholder="Dealership Website">
                    </div>
                </div>
                <div class="col-lg-6 col-md-6 col-sm-6 col-12">
                    <div class="form-group">
                        <label for="firstname4">First Name</label>
                        <input  id="first_name" name="first_name"  type="text" class="form-control required" placeholder="First Name">
                    </div>
                </div>
                <div class="col-lg-6 col-md-6 col-sm-6 col-12">
                    <div class="form-group">
                        <label for="lastname4">Last Name</label>
                      
                        <input id="last_name" name="last_name"  type="text" class="form-control required" placeholder="Last Name">
                    </div>
                </div>                
                <div class="col-lg-6 col-md-6 col-sm-6 col-12">
                    <div class="form-group">
                        <label for="phonenumber4">Phone Number</label>
                        <input id="phone" name="phone"  type="text" class="form-control required" placeholder="Phone">
                    </div>
                </div>
                <div class="col-lg-6 col-md-6 col-sm-6 col-12">
                    <div class="form-group">
                        <label for="workemail">Work Email</label>
                        <input id="email" name="email"  type="text" class="form-control required" placeholder="Work Email">
                    </div>
                </div>                
                <div class="col-12 mt--20">
                    <div class="form-group mb--0 text-center">
                        <a class="rainbow-gradient-btn submit" href="#"><span>Submit</span></a>
                    </div>
                </div>
            </form>
            <!-- End Form -->

            <button class="close-button" data-bs-dismiss="modal">
                <i class="feather-x"></i>
            </button>
        </div>
    </div>
</div>
<!-- End Book a Demo Modal  -->
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