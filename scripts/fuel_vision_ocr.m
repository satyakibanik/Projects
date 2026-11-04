#import <Foundation/Foundation.h>
#import <Vision/Vision.h>
int main(int argc, const char *argv[]) {
 @autoreleasepool {
  if (argc != 2) return 2;
  VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] init];
  request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
  request.usesLanguageCorrection = NO;
  request.recognitionLanguages = @[@"en-US"];
  VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithURL:[NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[1]]] options:@{}];
  NSError *error = nil;
  if (![handler performRequests:@[request] error:&error]) { fprintf(stderr,"%s\n",error.localizedDescription.UTF8String);return 1; }
  NSMutableArray *output = [NSMutableArray array];
  for (VNRecognizedTextObservation *observation in request.results) {
   VNRecognizedText *text = [observation topCandidates:1].firstObject;
   if (!text) continue;
   CGRect b = observation.boundingBox;
   [output addObject:@{@"text":text.string,@"confidence":@(text.confidence),@"x":@(b.origin.x),@"y":@(CGRectGetMidY(b)),@"height":@(b.size.height)}];
  }
  NSData *data = [NSJSONSerialization dataWithJSONObject:output options:0 error:&error];
  if (!data) return 1;
  fwrite(data.bytes,1,data.length,stdout);fputc('\n',stdout);
 }
 return 0;
}
