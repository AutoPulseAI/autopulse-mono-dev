<!-- Store Checkout Modal -->
<div class="modal fade" id="storeCheckout" tabindex="-1" aria-labelledby="storeCheckoutLabel" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered modal-lg">
    <div class="modal-content">
        <div class="modal-body">
            <button type="button" class="btn-close float-end" data-bs-dismiss="modal" aria-label="Close"></button>
            <div id="cardpopupbody" class="position-relative float-start w-100 px-lg-4 py-lg-4 p-3">
                <h5 class="modal-title text_primary mb-3"><b>Store Checkout</b></h5>

                <!-- Subscription plans selection -->
                <div class="position-relative">
                    <div class="row">
                        <div class="col col-7">
                            <div class="form-check">
                                <input class="form-check-input" type="radio" value="1" name="sub" id="monthsub">
                                <label class="form-check-label" for="monthsub">Monthly Subscription</label>
                                &nbsp;<a tabindex="0" data-bs-toggle="popover" data-bs-trigger="focus" data-bs-html="true" data-bs-placement="top" data-bs-content="Lorem ipsum dolor sit, amet consectetur adipisicing elit."><i class="fa-regular fa-circle-info"></i></a>
                            </div>
                        </div>
                        <div class="col col-5">
                            <div class="leads_by text-end">
                                <p class="mb-0">$599/ Month</p>
                            </div>
                        </div>
                    </div>

                    <div class="row">
                        <div class="col col-7">
                            <div class="form-check">
                                <input class="form-check-input" type="radio" value="0" name="sub" id="quarterlysub">
                                <label class="form-check-label" for="quarterlysub">Quarterly Subscription</label>
                                &nbsp;<a tabindex="0" data-bs-toggle="popover" data-bs-trigger="focus" data-bs-placement="top" data-bs-content="Lorem ipsum dolor sit, amet consectetur adipisicing elit."><i class="fa-regular fa-circle-info"></i></a>
                            </div>
                        </div>
                        <div class="col col-5">
                            <div class="leads_by text-end">
                                <p class="mb-0"><small class="text_secondary"><del>$1797</del></small>&nbsp;$1620/ Month</p>
                            </div>
                        </div>
                    </div>
                </div>

                <hr>

                <!-- Store List with coupon -->
                <div class="position-relative">
                    <div class="row gx-2 mb-3 justify-content-end">
                        <div class="col col-lg-4 col-md-6 col-12 d-flex align-items-center">
                            <div class="leads_by">
                                <p class="mb-0"><b>Store Number one</b></p>
                            </div>
                        </div>

                        <div class="col col-lg-3 col-md-6 col-12 d-flex align-items-center mb-lg-0 mb-2">
                            <div class="leads_by text-md-end w-100">
                                <p class="mb-0">$1620/-</p>
                            </div>
                        </div>

                        <div class="col col-lg-5 col-md-7 col-12">
                            <div class="input-group applyedit flex-nowrap">
                                <div class="leads_by w-100 d-none"><!-- d-none class added -->
                                    <p class="mb-0 form-control border-end-0 mb-0 pe-0"><i class="fa-solid fa-circle-check text-success me-1"></i>Coupon Code Applied!</p>
                                </div>
                                <input type="text" class="form-control border-end-0 mb-0 pe-0" placeholder="Type coupon code here">
                                <button class="btn border border-start-0 px-2 text_primary" type="button">APPLY</button>
                            </div>
                        </div>
                    </div>

                    <div class="row gx-2 mb-3 justify-content-end">
                        <div class="col col-lg-4 col-md-6 col-12 d-flex align-items-center">
                            <div class="leads_by">
                                <p class="mb-0"><b>Store Number two</b></p>
                            </div>
                        </div>

                        <div class="col col-lg-3 col-md-6 col-12 d-flex align-items-center mb-lg-0 mb-2">
                            <div class="leads_by text-md-end w-100">
                                <p class="mb-0"><small class="text_secondary"><del>$1620/-</del>&nbsp;</small>$1020/-</p>
                                <p class="mb-0 text-success text-nowrap"><small>You Saved $600 by Coupon!</small></p>
                            </div>
                        </div>

                        <div class="col col-lg-5 col-md-7 col-12">
                            <div class="input-group applyedit flex-nowrap">
                                <div class="leads_by w-100">
                                    <p class="mb-0 form-control border-end-0 mb-0 pe-0"><i class="fa-solid fa-circle-check text-success me-1"></i>Coupon Code Applied!</p>
                                </div>
                                <input type="text" class="form-control border-end-0 mb-0 pe-0 d-none" placeholder="Type coupon code here"><!-- d-none class added -->
                                <button class="btn border border-start-0 px-2 text_primary" type="button">EDIT</button>
                            </div>
                        </div>
                    </div>

                    <div class="row gx-2 mb-3 justify-content-end">
                        <div class="col col-lg-4 col-md-6 col-12 d-flex align-items-center">
                            <div class="leads_by">
                                <p class="mb-0"><b>Store Number three</b></p>
                            </div>
                        </div>

                        <div class="col col-lg-3 col-md-6 col-12 d-flex align-items-center mb-lg-0 mb-2">
                            <div class="leads_by text-md-end w-100">
                                <p class="mb-0">$1620/-</p>
                            </div>
                        </div>

                        <div class="col col-lg-5 col-md-7 col-12">
                            <div class="input-group applyedit flex-nowrap">
                                <div class="leads_by w-100 d-none"><!-- d-none class added -->
                                    <p class="mb-0 form-control border-end-0 mb-0 pe-0"><i class="fa-solid fa-circle-check text-success me-1"></i>Coupon Code Applied!</p>
                                </div>
                                <input type="text" class="form-control border-end-0 mb-0 pe-0" placeholder="Type coupon code here">
                                <button class="btn border border-start-0 px-2 text_primary" type="button">APPLY</button>
                            </div>
                        </div>
                    </div>
                </div>

                <hr>

                <div class="position-relative">
                    <div class="leads_by">
                        <p class="mb-0 d-flex"><span>You have added</span><span class="ms-auto">3 Stores</span></p>
                    </div>
                </div>

                <hr>

                <div class="position-relative checkout_unsub_stores" data-bs-toggle="collapse" data-bs-target="#collapseStores" aria-expanded="false" aria-controls="collapseStores">
                    <div class="leads_by">
                        <p class="mb-0">
                            <a href="javascript:" class="text_dark d-flex">
                                <span>Take subscription for other stores</span><span class="ms-auto"><i class="fa-solid fa-chevron-down"></i></span>
                            </a>
                        </p>
                    </div>
                </div>
                <div class="position-relative pt-3 collapse" id="collapseStores">
                    <div class="leads_by">
                        <p class="mb-2 d-flex"><span>Store Number Four</span><span class="ms-auto"><a href="javascript:" class="text_primary">Move to Cart</a></span></p>
                        <p class="mb-2 d-flex"><span>Store Number Four</span><span class="ms-auto"><a href="javascript:" class="text_primary">Move to Cart</a></span></p>
                        <p class="mb-2 d-flex"><span>Store Number Four</span><span class="ms-auto"><a href="javascript:" class="text_primary">Move to Cart</a></span></p>
                    </div>
                </div>

                <hr>

                <div class="position-relative mb-4">
                    <h5 class="mb-0 d-flex"><b>Total Amount</b><b class="ms-auto text_primary">$4260/-</b></h5>
                </div>

                <div class="position-relative text-center">
                    <div class="row">
                        <div class="col col-6">
                            <button data-bs-dismiss="modal" class="btn btn_theme_outline w-100">Cancel</button>
                        </div>
                        <div class="col col-6">
                            <a href="{{route('dealer.add_payment_method') }}" class="btn btn_theme w-100">Proceed</a>
                            <!-- <button class="btn btn_theme w-100" data-bs-toggle="modal" data-bs-target="#storeAdded" data-bs-dismiss="modal">Proceed</button> -->
                        </div>
                    </div>
                </div>

            </div>
        </div>
    </div>
  </div>
</div>