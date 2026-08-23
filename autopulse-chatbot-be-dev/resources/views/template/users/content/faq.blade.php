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
                        <h2>{{ $page->title }}</h2>
                    </div>
                    @foreach($forms as $data)
                    <div class="position-relative">
                        <div class="accordion" id="faqlist">
                            <div class="accordion-item">
                                <h2 class="accordion-header" id="headingOne">
                                <button class="accordion-button" type="button" data-bs-toggle="collapse" data-bs-target="#collapseOne" aria-expanded="true" aria-controls="collapseOne">
                                    Q.1 : {{ $data->form['text-1'] }}
                                </button>
                                </h2>
                                <div id="collapseOne" class="accordion-collapse collapse show" aria-labelledby="headingOne" data-bs-parent="#faqlist">
                                    <div class="accordion-body">
                                      {!! $data->form['content-1'] !!}
                                    </div>
                                </div>
                            </div>
                            <div class="accordion-item">
                                <h2 class="accordion-header" id="headingTwo">
                                <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapseTwo" aria-expanded="false" aria-controls="collapseTwo">
                                        Q.2 : {{ $data->form['text-2'] }}
                                </button>
                                </h2>
                                <div id="collapseTwo" class="accordion-collapse collapse" aria-labelledby="headingTwo" data-bs-parent="#faqlist">
                                    <div class="accordion-body">
                                      {!! $data->form['content-2'] !!}
                                    </div>
                                </div>
                            </div>
                            <div class="accordion-item">
                                <h2 class="accordion-header" id="headingThree">
                                    <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapseThree" aria-expanded="false" aria-controls="collapseThree">
                                        Q.3 : {{ $data->form['text-3'] }}
                                    </button>
                                </h2>
                                <div id="collapseThree" class="accordion-collapse collapse" aria-labelledby="headingThree" data-bs-parent="#faqlist">
                                    <div class="accordion-body">
                                      {!! $data->form['content-3'] !!}
                                    </div>
                                </div>
                            </div>
                            <div class="accordion-item">
                                <h2 class="accordion-header" id="headingThree">
                                    <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapsefour" aria-expanded="false" aria-controls="collapseThree">
                                        Q.4 : {{ $data->form['text-4'] }}
                                    </button>
                                </h2>
                                <div id="collapsefour" class="accordion-collapse collapse" aria-labelledby="headingThree" data-bs-parent="#faqlist">
                                    <div class="accordion-body">
                                      {!! $data->form['content-4'] !!}
                                    </div>
                                </div>
                            </div>

                            <div class="accordion-item">
                                <h2 class="accordion-header" id="headingThree">
                                    <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapsefive" aria-expanded="false" aria-controls="collapseThree">
                                        Q.5 : {{ $data->form['text-5'] }}
                                    </button>
                                </h2>
                                <div id="collapsefive" class="accordion-collapse collapse" aria-labelledby="headingThree" data-bs-parent="#faqlist">
                                    <div class="accordion-body">
                                      {!! $data->form['content-5'] !!}
                                    </div>
                                </div>
                            </div>

                            <div class="accordion-item">
                                <h2 class="accordion-header" id="headingThree">
                                    <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapsesix" aria-expanded="false" aria-controls="collapseThree">
                                        Q.6 : {{ $data->form['text-6'] }}
                                    </button>
                                </h2>
                                <div id="collapsesix" class="accordion-collapse collapse" aria-labelledby="headingThree" data-bs-parent="#faqlist">
                                    <div class="accordion-body">
                                      {!! $data->form['content-6'] !!}
                                    </div>
                                </div>
                            </div>

                            <div class="accordion-item">
                                <h2 class="accordion-header" id="headingThree">
                                    <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapseseven" aria-expanded="false" aria-controls="collapseThree">
                                        Q.7 : {{ $data->form['text-7'] }}
                                    </button>
                                </h2>
                                <div id="collapseseven" class="accordion-collapse collapse" aria-labelledby="headingThree" data-bs-parent="#faqlist">
                                    <div class="accordion-body">
                                      {!! $data->form['content-7'] !!}
                                    </div>
                                </div>
                            </div>

                            <div class="accordion-item">
                                <h2 class="accordion-header" id="headingThree">
                                    <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapseedigth" aria-expanded="false" aria-controls="collapseThree">
                                        Q.8 : {{ $data->form['text-8'] }}
                                    </button>
                                </h2>
                                <div id="collapseedigth" class="accordion-collapse collapse" aria-labelledby="headingThree" data-bs-parent="#faqlist">
                                    <div class="accordion-body">
                                      {!! $data->form['content-8'] !!}
                                    </div>
                                </div>
                            </div>

                            <div class="accordion-item">
                                <h2 class="accordion-header" id="headingThree">
                                    <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapsenine" aria-expanded="false" aria-controls="collapseThree">
                                        Q.9 : {{ $data->form['text-9'] }}
                                    </button>
                                </h2>
                                <div id="collapsenine" class="accordion-collapse collapse" aria-labelledby="headingThree" data-bs-parent="#faqlist">
                                    <div class="accordion-body">
                                      {!! $data->form['content-9'] !!}
                                    </div>
                                </div>
                            </div>

                            <div class="accordion-item">
                                <h2 class="accordion-header" id="headingThree">
                                    <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapseten" aria-expanded="false" aria-controls="collapseThree">
                                        Q.10 : {{ $data->form['text-10'] }}
                                    </button>
                                </h2>
                                <div id="collapseten" class="accordion-collapse collapse" aria-labelledby="headingThree" data-bs-parent="#faqlist">
                                    <div class="accordion-body">
                                      {!! $data->form['content-10'] !!}
                                    </div>
                                </div>
                            </div>

                            
                        </div>
                    </div>
                </div>
                @endforeach
            </div>
        </div>
    </div>

</section>


@endsection

