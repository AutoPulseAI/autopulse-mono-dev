'use client';

import React from 'react';
import { Swiper, SwiperSlide } from 'swiper/react';
import 'swiper/css';
import 'swiper/css/navigation';
import 'swiper/css/pagination';

import { Navigation, Pagination } from 'swiper/modules';

export default function PhotoSlider({ photourls }) {
  const imageUrls = photourls;

  return (
    <Swiper
        modules={[Navigation, Pagination]}
        navigation
        pagination={{ clickable: true }}
        spaceBetween={5}
        slidesPerView={1}
        className="custom_swiper"
      >
        {imageUrls.map((url, index) => (
          <SwiperSlide key={index}>
            <img
              src={url}
              alt={`Slide ${index + 1}`}
              className="w-full h-auto w-100"
            />
          </SwiperSlide>
        ))}
      </Swiper>
  );
}
