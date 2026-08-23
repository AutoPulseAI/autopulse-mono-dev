@extends('layouts.app')
@section('title', 'FAQ | autopulse.ai - Frequently Asked Questions')

@section('meta_description', 'Find answers to your questions about autopulse.ai. Browse our FAQ 
section for information on buying, selling, and financing vehicles, as well as our 
services and policies. Get the help you need today!
')
@section('content')
<section class="position-relative faq_page" id="subpage_mt">

    <!-- Contact Us -->
    <div class="position-relative section_padding">
        <div class="container">
            <div class="row justify-content-center">
                <div class="col col-lg-8 col-md-12 col-12">
                    <div class="section_heading text-center">
                        <h2>Frequently Asked Questions</h2>
                    </div>
                    <div class="position-relative">
                        <div class="accordion" id="faqlist">
                            <div class="accordion-item">
                                <h2 class="accordion-header" id="headingOne">
                                <button class="accordion-button" type="button" data-bs-toggle="collapse" data-bs-target="#collapseOne" aria-expanded="true" aria-controls="collapseOne">
                                    Q.1 : How do I search for cars on the Autopulse platform?
                                </button>
                                </h2>
                                <div id="collapseOne" class="accordion-collapse collapse show" aria-labelledby="headingOne" data-bs-parent="#faqlist">
                                    <div class="accordion-body">
                                        You can search for cars by entering specific criteria such as make, model, year, price range, mileage, and location into our search bar. You can also use filters to narrow down your search results based on factors like body type, fuel type, transmission, and more.
                                    </div>
                                </div>
                            </div>
                            <div class="accordion-item">
                                <h2 class="accordion-header" id="headingTwo">
                                <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapseTwo" aria-expanded="false" aria-controls="collapseTwo">
                                        Q.2 :How do I use Autopulse AI?
                                </button>
                                </h2>
                                <div id="collapseTwo" class="accordion-collapse collapse" aria-labelledby="headingTwo" data-bs-parent="#faqlist">
                                    <div class="accordion-body">
                                        Autopulse AI your AI-powered automotive assistant, offers a range of services including car search, price comparison, vehicle history checks, and maintenance tips. Accessible 24/7 through our website, Autopulse AI utilizes advanced algorithms to provide personalized assistance. Trustworthy and secure, Autopulse AI is your go-to resource for all your automotive needs. 
                                    </div>
                                </div>
                            </div>
                            <div class="accordion-item">
                                <h2 class="accordion-header" id="headingThree">
                                    <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapseThree" aria-expanded="false" aria-controls="collapseThree">
                                        Q.3 : Can I view vehicle history reports before purchasing a used car?
                                    </button>
                                </h2>
                                <div id="collapseThree" class="accordion-collapse collapse" aria-labelledby="headingThree" data-bs-parent="#faqlist">
                                    <div class="accordion-body">
                                        Yes, many of our listings include vehicle history reports from services like Carfax or AutoCheck. These reports provide valuable information about the vehicle's ownership history, accident history, service records, and more, helping you make an informed decision before purchasing a used car.
                                    </div>
                                </div>
                            </div>
                            <div class="accordion-item">
                                <h2 class="accordion-header" id="headingThree">
                                    <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapsefour" aria-expanded="false" aria-controls="collapseThree">
                                        Q.4 : Does Autopulse offer any warranties or guarantees on used cars sold through the Autopulse platform?
                                    </button>
                                </h2>
                                <div id="collapsefour" class="accordion-collapse collapse" aria-labelledby="headingThree" data-bs-parent="#faqlist">
                                    <div class="accordion-body">
                                        While we don't offer warranties or guarantees directly, many of the used cars sold through our platform may still be covered by the manufacturer's warranty or come with extended warranty options offered by the seller. Additionally, some sellers may offer their own limited warranties or guarantees for added peace of mind.
                                    </div>
                                </div>
                            </div>

                            <div class="accordion-item">
                                <h2 class="accordion-header" id="headingThree">
                                    <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapsefive" aria-expanded="false" aria-controls="collapseThree">
                                        Q.5 : Is it possible to schedule a test drive before purchasing a car?
                                    </button>
                                </h2>
                                <div id="collapsefive" class="accordion-collapse collapse" aria-labelledby="headingThree" data-bs-parent="#faqlist">
                                    <div class="accordion-body">
                                        Absolutely! Once you find a car you're interested in, you can contact the seller directly through our platform to schedule a test drive at a mutually convenient time. We encourage all buyers to take a test drive and inspect the vehicle in person before making a purchase.
                                    </div>
                                </div>
                            </div>

                            <div class="accordion-item">
                                <h2 class="accordion-header" id="headingThree">
                                    <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapsesix" aria-expanded="false" aria-controls="collapseThree">
                                        Q.6 : What payment methods are accepted for purchasing a car on your platform?
                                    </button>
                                </h2>
                                <div id="collapsesix" class="accordion-collapse collapse" aria-labelledby="headingThree" data-bs-parent="#faqlist">
                                    <div class="accordion-body">
                                        The accepted payment methods vary depending on the seller, but common options include cash, certified bank checks, wire transfers, and financing through third-party lenders. Most of our dealers provide finance options, based on your credit history and lender approval requirements. 
                                    </div>
                                </div>
                            </div>

                            <div class="accordion-item">
                                <h2 class="accordion-header" id="headingThree">
                                    <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapseseven" aria-expanded="false" aria-controls="collapseThree">
                                        Q.7 : Can I negotiate the price of a car with the seller?
                                    </button>
                                </h2>
                                <div id="collapseseven" class="accordion-collapse collapse" aria-labelledby="headingThree" data-bs-parent="#faqlist">
                                    <div class="accordion-body">
                                        Sellers may be open to negotiation, depending on their sales process.  Some dealers utilize a best-price sales process.  Other dealers offer a sales process that allows negotiating when buying a car through our platform. Once you've found a car you're interested in, you can contact the seller to discuss the price and any other terms of the sale.
                                    </div>
                                </div>
                            </div>

                            <div class="accordion-item">
                                <h2 class="accordion-header" id="headingThree">
                                    <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapseedigth" aria-expanded="false" aria-controls="collapseThree">
                                        Q.8 : What happens if I'm not satisfied with a car I've purchased?
                                    </button>
                                </h2>
                                <div id="collapseedigth" class="accordion-collapse collapse" aria-labelledby="headingThree" data-bs-parent="#faqlist">
                                    <div class="accordion-body">
                                         If you encounter any issues with a car you've purchased through our platform, we recommend contacting the seller to discuss possible resolutions. Many sellers are willing to work with buyers to address concerns. Autopulse is an automotive marketplace connecting buyers and sellers.  Autopulse does not make any representations or guarantees.  It is always the responsibility of the buyer and seller to conduct their due diligence tied to the transaction. 
                                    </div>
                                </div>
                            </div>

                            <div class="accordion-item">
                                <h2 class="accordion-header" id="headingThree">
                                    <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapsenine" aria-expanded="false" aria-controls="collapseThree">
                                        Q.9 : Are there any fees associated with buying or selling on your platform?
                                    </button>
                                </h2>
                                <div id="collapsenine" class="accordion-collapse collapse" aria-labelledby="headingThree" data-bs-parent="#faqlist">
                                    <div class="accordion-body">
                                        Listing a vehicle for sale on our platform is free for private parties. There are no fees for buyers to browse listings or contact sellers.
                                    </div>
                                </div>
                            </div>

                            <div class="accordion-item">
                                <h2 class="accordion-header" id="headingThree">
                                    <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapseten" aria-expanded="false" aria-controls="collapseThree">
                                        Q.10 : What types of vehicles can I buy and sell on the Autopulse platform?
                                    </button>
                                </h2>
                                <div id="collapseten" class="accordion-collapse collapse" aria-labelledby="headingThree" data-bs-parent="#faqlist">
                                    <div class="accordion-body">
                                        The Autopulse platform allows users to buy and sell a wide range of vehicles, including cars, trucks, SUVs, electric vehicles, and vans. We currently do not list motorcycles, commercial vehicles, RVs, or power sports inventory.
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


@endsection

